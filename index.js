
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

const io = new Server(server);
io.on("connection", (socket) => {  
    console.log('connection');
    socket.emit('updatePlaylist', playlist);
    if (videoRunning) { socket.emit('play', currentlyPlaying, sw.read(), maxtime); }
});

const sw = new Stopwatch();


function cleanPath() {
    const path = require('path');
    const directory = 'movies';
    fs.readdir(directory, (err, files) => {
    if (err) throw err;
    for (const file of files) {
        fs.unlink(path.join(directory, file), err => {
        if (err) throw err;
        });
    }
    });
}
function startConversion(url) {
    converting = true;
		var ffmpegOptions = [
			'-profile:v baseline',
			'-level 3.0',
			'-start_number 0',
			'-hls_time 10',
			'-hls_list_size 0',
			'-f hls'
    ];

		//Convert ytdl stream to .m3u8
    var stream = ytdl(url, {format: 'mp4' });
    var proc = new ffmpeg({source: stream});
    proc.setFfmpegPath(ffmpegInstaller.path);
    var output = proc.addOptions(ffmpegOptions).output('movies/output'+conversionIndex+'.m3u8');

    fs.watch('movies/', (curr, prev) => {
			if (!videoRunning && fs.existsSync('movies/output'+conversionIndex+'.m3u8')) {
				createStream(server);
				sw.reset();
				maxtime = playlist[conversionIndex].lengthSeconds;
				videoRunning = true;
				videoTimeout();
				io.emit("play", 'movies/output'+index+'.m3u8', 0, index, maxtime);
				sw.start();
				currentlyPlaying = 'movies/output'+index+'.m3u8';
			}
    });

    output.on('end', () => {
			if (playlist[conversionIndex+1] == undefined) {
				console.log('end'); 
				playlist = [];
				conversionIndex = 0;
				converting = false;
				return;
			}else {
				conversionIndex++;
				startConversion(playlist[conversionIndex].video_url);
				return;
			}
    }).run();
}

function videoTimeout() {
    setTimeout(() => {
        index++;
        sw.stop();
				if (!converting) {
					index = -1;
					sw.reset();
					videoRunning = false;
					return;
				}
        if (fs.existsSync('movies/output'+index+'.m3u8') && currentlyPlaying != 'movies/output'+index+'.m3u8') {
            createStream(server);
            maxtime = playlist[index].lengthSeconds;
            videoRunning = true;
            videoTimeout();
            sw.start();
            io.emit("play", 'movies/output'+index+'.m3u8', index, maxtime);
            currentlyPlaying = 'movies/output'+index+'.m3u8';
        }else { videoRunning = false; }
    }, maxtime*1000);
}

//Get playlist
app.get('/getplaylist', (req, res) => {
    res.send(playlist);
});

async function addVideo(url) {
    var stream = await ytdl(url, {format: 'mp4' });
    stream.on('info', (info) => {
        playlist[playlist.length] = info.videoDetails;
        //console.log(info.videoDetails);
        
    io.emit('updatePlaylist', playlist, index);
        if (index == -1) { 
            index = 0; 
            cleanPath();
            startConversion(playlist[0].video_url);
        }else if (!converting) {
            startConversion(playlist[0].video_url);
        }
        stream.destroy();
        return true;
    });  
}

//Add video to list
app.post('/addvideo', async (req, res) => {
    addVideo(req.body.url);
});
