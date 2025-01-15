goog.provide('lime.audio.Audio');

goog.require('goog.events');
goog.require('goog.events.EventTarget');
goog.require('lime.userAgent');

/**
 * Audio stream object
 * @constructor
 * @param {string} filePath Path to audio file.
 */
lime.audio.Audio = function(filePath, useBaseElement) {
    goog.events.EventTarget.call(this);

    if(filePath && goog.isFunction(filePath.data)){
        filePath = filePath.data();
    }

    /**
     * @type {Boolean}
     * @private
     */
    this.loaded_ = false;

    /**
     * @type {boolean}
     * @private
     */
    this.playing_ = false;

    /**
     * @type {boolean}
     * @private
     */
    this.isLocalFile_ = false;
	
    if (goog.userAgent.GECKO && (/\.mp3$/).test(filePath)) {
        filePath = filePath.replace(/\.mp3$/, '.ogg');
    }
	
	/**
	 * 檢查是否為本機的程式與本機的聲音檔, 
	 * 是的話， AudioContext 改用 baseElement, 
	 * 以免因 XMLHttpRequest 無法用, 而無法播放
	 */
	if (/file/i.test(location['protocol']) && !((/(^http)|base64/i.test(filePath))||filePath.length>2048)) {
		this.isLocalFile_ = true;
	} else {
		this.isLocalFile_ = false;
	}
	
	/* force to use baseElement */
	if(typeof(useBaseElement)=='boolean' && useBaseElement) {
		this.isLocalFile_ = true;
	}

    if (lime.audio.AudioContext && !this.isLocalFile_) {
        this.volume_ = 1;
		this.playbackRate_ = 1; //add by gsyan
        this.prepareContext_();	
		this.loadBuffer(filePath, goog.bind(this.bufferLoadedHandler_, this));
    }
    else {
        /**
         * Internal audio element
         * @type {audio}
         */
        this.baseElement = document.createElement('audio');
        this.baseElement['preload'] = true;
        this.baseElement['loop'] = false;
		//this.baseElement['type'] = "audio/mp3";
        this.baseElement.src = filePath;
        //this.baseElement.load();
        this.baseElement.addEventListener('ended', goog.bind(this.onEnded_, this));
        this.loadInterval = setInterval(goog.bind(this.loadHandler_, this), 10);

        this.loaded_ = false;
    }
};
goog.inherits(lime.audio.Audio, goog.events.EventTarget);

lime.audio.AudioContext = goog.global['AudioContext'] || goog.global['webkitAudioContext'];
lime.audio._buffers = {};

lime.audio.supportsMultiChannel = lime.audio.AudioContext || !(lime.userAgent.IOS || lime.userAgent.WINPHONE);

lime.audio.Audio.prototype.prepareContext_ = function() {
    //if (lime.audio.context) return;
	if (typeof(lime.audio.context)!='undefined' 
			&& lime.audio.context != null
			&& typeof(lime.audio.context['createGain'])=='function'
			&& typeof(lime.audio.context['createBufferSource'])=='function'
	) return; //2023.05.10 modified by gsyan : prevent compileed code be rewrite;
    var context = lime.audio.context = new lime.audio.AudioContext();
    var gain = lime.audio.masterGain = context['createGain']();
    gain['connect'](context['destination']);
};

lime.audio.Audio.prototype.loadBuffer = function (path, cb) {
    var buffers = lime.audio._buffers;
    if (buffers[path] && buffers[path].buffer) {
        cb(buffers[path].buffer, path);
    }
    else if (buffers[path]) {
        buffers[path].push(cb);
    }
    else if (path.match(/data:audio\/(ogg|mp3|mpeg);base64,/) || path.length % 4 == 0 && path.match(/^[A-Za-z0-9+\/=]+\Z/) ) {	
    	//如果傳來的資料符合 base64 的特徵，就進行資料解碼的程序
		//不用呼叫 XMLHttpRequest
		console.log('base64 audio');
		if( path.match(/data:audio\/(ogg|mp3|mpeg);base64,/) ) {
			path = path.replace(/data:audio\/(ogg|mp3|mpeg);base64,/, '');
		}
    	buffers[path] = [cb];
    	var myBuffer = this.decodeArrayBuffer(path);
    	lime.audio.context['decodeAudioData'](myBuffer, function(buffer) {
    		var cbArray = buffers[path];
    		buffers[path] = {buffer: buffer};
    		for (var i=0; i < cbArray.length; i++) {
                cbArray[i](buffer, path);
            }
    	});
	}
    else {
        buffers[path] = [cb];
        var req = new XMLHttpRequest();
        req.open('GET', path, true);
        req.responseType = 'arraybuffer';
        req.onload = function() {
            lime.audio.context['decodeAudioData'](req.response, function(buffer) {
               if (!buffer) {
                   return console.error('Error decoding file:', path);
               }
               var cbArray = buffers[path];
               buffers[path] = {buffer: buffer};
               for (var i=0; i < cbArray.length; i++) {
                   cbArray[i](buffer, path);
               }
            }, function(e){console.error('Error decoding file',e);});
        };
        req.onerror = function() {
          console.error('XHR error loading file:', path);
        };
        req.send();
    }
};

lime.audio.Audio.prototype.bufferLoadedHandler_ = function (buffer, path) {
    this.buffer = buffer;
    this.loaded_ = true;
    var ev = new goog.events.Event('loaded');
    ev.event = null;
    this.dispatchEvent(ev);
    if (this.autoplay_) {
        this.play.apply(this, this.autoplay_);
    }
};

lime.audio.Audio.prototype.onEnded_ = function (e) {
    this.playing_ = false;
	
    var ev = new goog.events.Event('ended');
    ev.event = e;
    this.dispatchEvent(ev);
    this.playPosition_ = 0;
    var delay = lime.audio.AudioContext  && !this.isLocalFile_ ? this.playTime_ + this.buffer.duration - this.playPositionCache - 0.05 : 0;
    if (this.next_) {
        for (var i = 0; i < this.next_.length; i++) {
            this.next_[i][0].play(this.next_[i][1], delay);
        }
    }
    else if (ev.returnValue_ !== false && this.loop_) {
        this.play(this.loop_, delay);
    }
}

/**
 * Handle loading the audio file. Event handlers seem to fail
 * on lot of browsers.
 * @private
 */
lime.audio.Audio.prototype.loadHandler_ = function() {
    if (this.baseElement['readyState'] > 2) {
        this.bufferLoadedHandler_();
        clearTimeout(this.loadInterval);
    }
    if (this.baseElement['error'])clearTimeout(this.loadInterval);

    if (lime.userAgent.IOS && this.baseElement['readyState'] == 0) {
        //ios hack do not work any more after 4.2.1 updates
        // no good solutions that i know
        this.bufferLoadedHandler_();
        clearTimeout(this.loadInterval);
        // this means that ios audio anly works if called from user action
    }
};

/**
 * Returns true if audio file has been loaded
 * @return {boolean} Audio has been loaded.
 */
lime.audio.Audio.prototype.isLoaded = function() {
    return this.loaded_;
};

/**
 * Returns true if audio file is playing
 * @return {boolean} Audio is playing.
 */
lime.audio.Audio.prototype.isPlaying = function() {
    return this.playing_;
};

/**
 * Start playing the audio
 * @param {number=} opt_loop Loop the sound.
 */
lime.audio.Audio.prototype.play = function(opt_loop, opt_startTime, opt_endTime) {
    if (!this.isLoaded()) {
        this.autoplay_ = goog.array.toArray(arguments);
    }
    if (this.isLoaded() && !this.isPlaying() && !lime.audio.getMute()) {
		var isOK = false;
        //if (lime.audio.AudioContext  && !this.isLocalFile_) {
		if (typeof(lime.audio.context)!='undefined' 
				&& lime.audio.context != null
				&& typeof(lime.audio.context['createGain'])=='function'
				&& !this.isLocalFile_
			)
		{
            if (this.source && this.source['playbackState'] == this.source['FINISHED_STATE']) {
                this.playPosition_ = 0;
            }
			this.source = lime.audio.context['createBufferSource']();
			this.source.buffer = this.buffer;
            this.gain = lime.audio.context['createGain']();
            this.gain['connect'](lime.audio.masterGain);
            this.gain['gain']['value'] = this.volume_;
			this.source['playbackRate']['value'] = this.playbackRate_; //add by gsyan
            this.source['connect'](this.gain);

            this.playTime_ = lime.audio.context['currentTime'];
            var delay = arguments[1] || 0
			
			//var startTime = arguments[2] || null;
			//var endTime
			if(typeof(opt_startTime)!='undefined' && !isNaN(opt_startTime) && typeof(opt_endTime)!='undefined' && !isNaN(opt_endTime)) {
				//add by gsyan : play from opt_startTime to opt_endTime
				if(opt_endTime>this.buffer.duration) {
					opt_endTime = this.buffer.duration;
				}
				this.source['start'](this.playTime_, opt_startTime, opt_endTime-opt_startTime);
				
				this.playPosition_ = opt_startTime;
				this.endTime_ = opt_endTime;
				this.playPositionCache = this.playPosition_;
				this.endTimeout_ = setTimeout(goog.bind(this.onEnded_, this),
					(opt_endTime - ( opt_startTime  || 0)) * 1000 - 150);
				
			} else {
				if (this.playPosition_ > 0) {
					this.source['start'](delay, this.playPosition_, this.buffer.duration - this.playPosition_);
				}
				else {
					this.source['start'](delay);
				}
				this.playPositionCache = this.playPosition_;
				this.endTimeout_ = setTimeout(goog.bind(this.onEnded_, this),
					(this.buffer.duration - (this.playPosition_ || 0)) * 1000 - 150);
			}
			isOK = true;
        }
        else {
			if(typeof(this.baseElement)!='undefined' 
				&& this.baseElement!=null
				&& typeof(this.baseElement.play)=='function')
			{
				this.baseElement.play();
				isOK = true;
			}
        }
		if(isOK) {
			this.playing_ = true;
			this.loop_ = !!opt_loop;
			if (lime.audio._playQueue.indexOf(this) == -1) {
			  lime.audio._playQueue.push(this);
			}
		}
    }
};

/**
 * Stop playing the audio
 */
lime.audio.Audio.prototype.stop = function() {
    if (!this.isLoaded()) {
        this.autoplay_ = null;
    }
    if (this.isPlaying()) {
        if (lime.audio.AudioContext && !this.isLocalFile_) {
            clearTimeout(this.endTimeout_);
            this.playPosition_ = lime.audio.context.currentTime - this.playTime_ + (this.playPosition_ || 0);
            if (this.playPosition_ > this.buffer.duration) {
                this.playPosition_ = 0;
            }
            this.source['stop'](0);
            this.gain['disconnect'](lime.audio.masterGain);
            this.source = null;
        }
        else {
            this.baseElement.pause();
        }
        this.playing_ = false;
    }
};

lime.audio._isMute = false;
lime.audio._playQueue = [];

lime.audio.getMute = function() {
  return lime.audio._isMute;
};

lime.audio.setMute = function(bool) {
  if (bool && !lime.audio._isMute) {
    for (var i = 0; i < lime.audio._playQueue.length; i++) {
      lime.audio._playQueue[i].stop();
    }
    lime.audio._playQueue = [];
  }
  lime.audio._isMute = bool;
};

lime.audio.Audio.prototype.setVolume = function(value) {
    if (lime.audio.AudioContext && !this.isLocalFile_) {
        this.volume_ = value;
        if (this.gain) this.gain['gain']['value'] = value;
    }
    else {
        this.baseElement.volume = value;
    }
};
lime.audio.Audio.prototype.getVolume = function() {
    if (lime.audio.AudioContext && !this.isLocalFile_) {
        return this.volume_;
    }
    else {
        return this.baseElement.volume;
    }
};

//playbackRate add gsyan(2023.06.21)
lime.audio.Audio.prototype.setPlaybackRate = function(value) {
    if (lime.audio.AudioContext && !this.isLocalFile_) {
        this.playbackRate_ = value;
        if (this.source) this.source['playbackRate']['value'] = value;
    }
    else {
        this.baseElement['playbackRate'] = value;
    }
};
lime.audio.Audio.prototype.getPlaybackRate = function() {
    if (lime.audio.AudioContext && !this.isLocalFile_) {
        return this.playbackRate_;
    }
    else {
        return this.baseElement['playbackRate'];
    }
};

//base64 decode: add by gsyan
/*
Copyright (c) 2011, Daniel Guerrero
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL DANIEL GUERRERO BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * Uses the new array typed in javascript to binary base64 encode/decode
 * at the moment just decodes a binary base64 encoded
 * into either an ArrayBuffer (decodeArrayBuffer)
 * or into an Uint8Array (decode)
 * 
 * References:
 * https://developer.mozilla.org/en/JavaScript_typed_arrays/ArrayBuffer
 * https://developer.mozilla.org/en/JavaScript_typed_arrays/Uint8Array
 */

/* will return a  Uint8Array type */
lime.audio.Audio.prototype.decodeArrayBuffer = function(input) {
	var bytes = (input.length/4) * 3;
	var ab = new ArrayBuffer(bytes);
	this.decode(input, ab);
	
	return ab;
}
	
lime.audio.Audio.prototype.decode = function(input, arrayBuffer) {
	var decodeKeyStr_ = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
	//get last chars to see if are valid
	var lkey1 = decodeKeyStr_.indexOf(input.charAt(input.length-1));		 
	var lkey2 = decodeKeyStr_.indexOf(input.charAt(input.length-2));		 

	var bytes = (input.length/4) * 3;
	if (lkey1 == 64) bytes--; //padding chars, so skip
	if (lkey2 == 64) bytes--; //padding chars, so skip
	
	var uarray;
	var chr1, chr2, chr3;
	var enc1, enc2, enc3, enc4;
	var i = 0;
	var j = 0;
	
	if (arrayBuffer)
		uarray = new Uint8Array(arrayBuffer);
	else
		uarray = new Uint8Array(bytes);
	
	input = input.replace(/[^A-Za-z0-9\+\/\=]/g, "");
	
	for (i=0; i<bytes; i+=3) {	
		//get the 3 octects in 4 ascii chars
		enc1 = decodeKeyStr_.indexOf(input.charAt(j++));
		enc2 = decodeKeyStr_.indexOf(input.charAt(j++));
		enc3 = decodeKeyStr_.indexOf(input.charAt(j++));
		enc4 = decodeKeyStr_.indexOf(input.charAt(j++));

		chr1 = (enc1 << 2) | (enc2 >> 4);
		chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
		chr3 = ((enc3 & 3) << 6) | enc4;

		uarray[i] = chr1;			
		if (enc3 != 64) uarray[i+1] = chr2;
		if (enc4 != 64) uarray[i+2] = chr3;
	}

	return uarray;	
}
