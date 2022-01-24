
const app = require('express')();
const fs = require('fs');
const { Server } = require("socket.io");
const bodyParser = require("body-parser");
const ytdl = require('ytdl-core');
const ffs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const Stopwatch = require('statman-stopwatch');
const ytpl = require('ytpl');
const ffmpegOptions = [
	'-profile:v baseline',
	'-level 3.0',
	'-start_number 0',
	'-hls_time 10',
	'-vcodec libx264',
	'-crf 27',
	'-preset ultrafast',
	'-movflags +faststart',
	'-vf scale=iw/2:-2',
	'-s 380x180',
	'-c:a copy',
	'-hls_list_size 0',
	'-f hls'
];

const createStream = require('./createStream.js');

app.get('/', (req, res) => {
    return res.status(200).sendFile(`${__dirname}/client.html`);
});
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
const server = app.listen(3000);

var converting = false;
var currentlyPlaying = '';
var videoRunning = false;
let conversionIndex = 0
var playlist = [];
let index = -1;
let maxtime = 0;
const path = require('path');
const directory = 'movies';

const io = new Server(server);
io.on("connection", (socket) => {  
	console.log('connection');
	socket.emit('updatePlaylist', playlist);
	if (videoRunning) { socket.emit('play', currentlyPlaying, sw.read(), index, maxtime, playlist[index]); }
});

const sw = new Stopwatch();

function cleanPath() {
	fs.readdir(directory, (err, files) => {
	if (err) throw err;
	for (const file of files) {
			fs.unlink(path.join(directory, file), err => {
			if (err) throw err;
			});
	}
	});
}

function videoTimeout() {
	setTimeout(() => {
		index++;
		fs.readdir(directory, (err, files) => {
			if (err) throw err;
			for (const file of files) {
				if (!file.includes('output'+(index-1))) continue;

				fs.unlink(path.join(directory, file), err => {
				if (err) throw err;
				});
			}
		});
		sw.stop();
		if (playlist[index] == undefined) { videoRunning = false; return; }
		if (playlist[index].converted) {
			startVideoFromIndex()
		}else { 
			videoRunning = false;
		}
	}, maxtime*1000);
}

function startVideoFromIndex() {
	createStream(server);
	maxtime = playlist[index].lengthSeconds;
	videoRunning = true;
	videoTimeout();
	sw.reset();
	sw.start();
	io.emit("play", 'movies/output'+index+'.m3u8', sw.read(), index, maxtime, playlist[index]);
	currentlyPlaying = 'movies/output'+index+'.m3u8';
}

function startConversion(url) {
	converting = true;

	//Get stream
	var stream = ytdl(url, {format: 'mp4' });
	var proc = new ffmpeg({source: stream});
	proc.setFfmpegPath(ffmpegInstaller.path);
	var output = proc.addOptions(ffmpegOptions).output('movies/output'+conversionIndex+'.m3u8');

	output.on('end', () => {
		playlist[conversionIndex].converted = true;
		if (playlist[conversionIndex+1] != undefined) {
			conversionIndex++;
			startConversion(playlist[conversionIndex].video_url);
		}else { converting = false; }
	}).run();

	fs.watch('movies/', (curr, prev) => {
		if (!videoRunning && fs.existsSync('movies/output'+conversionIndex+'.m3u8')) {
			startVideoFromIndex();
		}
	});
}

async function addVideo(url) {
	var stream = await ytdl(url, {format: 'mp4' });
	stream.on('info', (info) => {
		info.videoDetails.converted = false;
		playlist[playlist.length] = info.videoDetails;
		io.emit('updatePlaylist', playlist, index);

		if (index == -1) { 
			index = 0; 
			cleanPath();
			startConversion(playlist[0].video_url);
		}else if (!converting) {
			conversionIndex++;
			startConversion(info.videoDetails.video_url);
		}

		stream.destroy();
		return true;
	});  
}

//Add video to list
app.post('/addvideo', async (req, res) => {
    addVideo(req.body.url);
});

//Get playlist
app.get('/getplaylist', (req, res) => {
    res.send(playlist);
});
