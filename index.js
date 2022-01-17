


const app = require('express')();
const fs = require('fs');
const hls = require('hls-server');

app.get('/', (req, res) => {
    return res.status(200).sendFile(`${__dirname}/client.html`);
});

const server = app.listen(3000);

var converting = false;
var currentlyPlaying = '';
var videoRunning = false;
let conversionIndex = 0;

var playlist = [];
let index = -1;

const { Server } = require("socket.io");
const io = new Server(server);
io.on("connection", (socket) => {  
    console.log('connection');
    socket.emit('updatePlaylist', playlist);
    if (videoRunning) { socket.emit('play', currentlyPlaying, sw.read()); }
});

const bodyParser = require("body-parser");
app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(bodyParser.json());

let uptime = 0;
const Stopwatch = require('statman-stopwatch');
const sw = new Stopwatch();
let maxtime = 0;
const ytdl = require('ytdl-core');
const ffs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

function createStream() {
    new hls(server, {
        provider: {
            exists: (req, cb) => {
                const ext = req.url.split('.').pop();

                if (ext !== 'm3u8' && ext !== 'ts') {
                    return cb(null, true);
                }

                fs.access(__dirname + req.url, fs.constants.F_OK, function(err) {
                    if (err) {
                        console.log('File not exist');
                        return cb(null, false);
                    }
                    cb(null, true);
                });
            },
            getManifestStream: (req, cb) => {
                const stream = fs.createReadStream(__dirname + req.url);
                cb(null, stream);
            },
            getSegmentStream: (req, cb) => {
                const stream = fs.createReadStream(__dirname + req.url);
                cb(null, stream);
            }
        }
    });
}

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
    var stream = ytdl(url, {format: 'mp4' });
    var proc = new ffmpeg({source: stream});
    proc.setFfmpegPath(ffmpegInstaller.path);
    var output = proc.addOptions([
        '-profile:v baseline',
        '-level 3.0',
        '-start_number 0',
        '-hls_time 10',
        '-hls_list_size 0',
        '-f hls'
    ]).output('movies/output'+conversionIndex+'.m3u8');
    fs.watch('movies/', (curr, prev) => {
        if (index == conversionIndex && !videoRunning && fs.existsSync('movies/output'+conversionIndex+'.m3u8') && !(currentlyPlaying === 'movies/output'+conversionIndex+'.m3u8')) {
            createStream();
            maxtime = playlist[conversionIndex].lengthSeconds;
            videoRunning = true;
            setTimeout(() => {        
                sw.stop();
                videoRunning = false;
                index++;
                if (fs.existsSync('movies/output'+index+'.m3u8') && currentlyPlaying != 'movies/output'+index+'.m3u8') {
                    createStream();
                    sw.start();
                    maxtime = playlist[index].lengthSeconds;
                    videoRunning = true;
                    videoTimeout();
                    io.emit("play", 'movies/output'+index+'.m3u8', 0, index);
                    currentlyPlaying = 'movies/output'+index+'.m3u8';
                }
            }, maxtime*1000);
            io.emit("play", 'movies/output'+index+'.m3u8', 0, index);
            sw.start();
            currentlyPlaying = 'movies/output'+index+'.m3u8';
        }
    });
    output.on('end', () => {
        if (playlist[conversionIndex+1] == undefined) {
           console.log('end'); 
           playlist = [];
           conversionIndex = 0;
           io.emit('updatePlaylist', playlist, index);
           converting = false;
        }else {
            conversionIndex++;
            startConversion(playlist[conversionIndex].video_url);
            io.emit('updatePlaylist', playlist, index);
        }
    }).run();
}


function videoTimeout() {
    setTimeout(() => {        
        videoRunning = false;
        index++;
        sw.stop();
        if (fs.existsSync('movies/output'+index+'.m3u8') && currentlyPlaying != 'movies/output'+index+'.m3u8') {
            createStream();
            maxtime = playlist[index].lengthSeconds;
            videoRunning = true;
            videoTimeout();
            sw.start();
            io.emit("play", 'movies/output'+index+'.m3u8', index);
            currentlyPlaying = 'movies/output'+index+'.m3u8';
        }
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

const ytpl = require('ytpl');
//Add video to list
app.post('/addvideo', async (req, res) => {
    addVideo(req.body.url);
});
