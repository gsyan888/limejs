goog.provide('lime.scheduleManager');

goog.require('goog.array');
goog.require('goog.userAgent');
goog.require('lime');


/**
 * Unified timer provider class
 * Don't create instances of this class. Used the shared instance.
 * @this {lime.scheduleManager}
 * @constructor
 */
lime.scheduleManager = new (function() {

    /**
     * Array of registered functions
     * @type {Array.<lime.scheduleManager.Task>}
     * @private
     */
    this.taskStack_ = [];

    /**
     * ScheduleManager is active
     * @type {boolean}
     * @private
     */
    this.active_ = false;
    this.started_ = false;

    /**
     * Internal setInterval id
     * @type {number}
     * @private
     */
    this.intervalID_ = 0;

    /**
     * Internal requestAnimationFrame id
     * @type {number}
     * @private
     */
    this.requestID_ = 0;

    /**
     * Maximum update rate in ms.
     * @type {number}
     * @private
     */
    this.displayRate_ = 1000 / 30;

    /**
     * Timer last fire timestamp
     * @type {number}
     * @private
     */
    this.lastRunTime_ = 0;

})();

/**
 * Add JSDoc tag to avoid warning. by gsyan
 * @this {lime.scheduleManager}
 */
lime.scheduleManager.Callback = function (f, ctx, delta) {
    this.f = f;
    this.ctx = ctx;
    this.paused = false;
    this.delta = delta;
}

/**
 * Scheduled task
 * @param {number} maxdelta Timer wait value after iteration.
 * @param {number=} opt_limit Number of calls.
 * @constructor
 */
lime.scheduleManager.Task = function(maxdelta, opt_limit) {
    this.maxdelta = maxdelta;
    this.limit = goog.isDef(opt_limit) ? opt_limit : -1;
    this.functionStack_ = [];
};

/**
 * Handle iteration
 * @param {number} dt Delta time since last iteration.
 * @private
 */
lime.scheduleManager.Task.prototype.step_ = function(dt) {
    if (!this.functionStack_.length) return;

    var f;
    var i = this.functionStack_.length;

    while (--i >= 0) {
        f = this.functionStack_[i];
        if (f && !f.paused && goog.isFunction(f.f)) {
            if (f.delta > dt) {
                f.delta -= dt;
            }
            else {
                var delta = this.maxdelta + dt - f.delta;
                f.delta = this.maxdelta - (dt - f.delta);
                if (f.delta < 0) f.delta = 0;
                (f.f).call(f.ctx, delta);

                if (this.limit !== -1) {
                    this.limit--;
                    if (this.limit == 0) {
                        lime.scheduleManager.unschedule(f.id);
                    }
                }
            }
        }
    }

};

lime.scheduleManager.taskStack_.push(new lime.scheduleManager.Task(0));

(function() {
    var vendors = ['webkit', 'moz'];
    for(var x = 0; x < vendors.length && !goog.global.requestAnimationFrame; ++x) {
        goog.global.requestAnimationFrame = window[vendors[x]+'RequestAnimationFrame'];
        goog.global.cancelAnimationFrame =
          goog.global[vendors[x]+'CancelAnimationFrame'] || goog.global[vendors[x]+'CancelRequestAnimationFrame'];
    }
}());


/**
 * Whether to use requestAnimationFrame instead of timer events
 * Exposed here so it could be disabled if needed.
 * @type {boolean}
 */
lime.scheduleManager.USE_ANIMATION_FRAME = !!goog.global.requestAnimationFrame;

/**
 * Returns maximum fire rate in ms. If you need FPS then use 1000/x
 * @this {lime.scheduleManager}
 * @return {number} Display rate.
 */
lime.scheduleManager.getDisplayRate = function() {
    //todo: bad name
    return this.displayRate_;
};

/**
 * Sets maximum fire rate for the scheduler in ms.
 * If you have FPS then send 1000/x
 * Note that if animation frame methods are used browser chooses
 * max display rate and this value has no effect.
 * @this {lime.scheduleManager}
 * @param {number} value New display rate.
 */
lime.scheduleManager.setDisplayRate = function(value) {
     this.displayRate_ = value;
     if (this.active_) {
         lime.scheduleManager.disable_();
         lime.scheduleManager.activate_();
     }
};
/**
 * Generate unique id for scheduled function
 */
lime.scheduleManager.nextFunctionId__=(function() {
	var curId = 0;
	//next id
	return function(){return curId++};
})()
/**
 * Schedule a function. Passed function will be called on every frame
 * with delta time from last run time
 * @this {lime.scheduleManager}
 * @param {function(number)} f Function to be called.
 * @param {Object} context The context used when calling function.
 * @param {lime.scheduleManager.Task=} opt_task Task object.
 */

lime.scheduleManager.schedule = function(f, context, opt_task) {
    var task = goog.isDef(opt_task) ? opt_task : this.taskStack_[0];
	var cb = new this.Callback(f, context, task.maxdelta);
	cb.id = this.nextFunctionId__();
    goog.array.insert(task.functionStack_, cb);
    goog.array.insert(this.taskStack_, task);
    if (!this.active_) {
        lime.scheduleManager.activate_();
    }
};

/**
 * Unschedule a function. For functions that have be previously scheduled
 * @this {lime.scheduleManager}
 * @param {Number} functionId Id generated when scheduling.
 */
lime.scheduleManager.unschedule = function(functionId) {
    var j = this.taskStack_.length;
    //Just for compatible with the old API lime.scheduleManager.unschedule(function,context)
    var isEqualFun = goog.isFunction(functionId)?(function(context) {
    // this can be deprecated again if animations/scroller are moved to new API
    // console&&console.warn&&console.warn("lime.scheduleManager.unschedule(function,context)" +
    // " is deprecated,You can use  unschedule(functionId) to replace it," +
    // "details see https://github.com/digitalfruit/limejs/issues/43")
        return function(f) {return f.f == functionId && f.ctx == context}
    })(arguments[1]):function(f) {
        return f.id == functionId;
    }
    while (--j >= 0) {
        var task = this.taskStack_[j],
            functionStack_ = task.functionStack_,
            fi, i = functionStack_.length;
        while (--i >= 0) {
            fi = functionStack_[i];
            if (isEqualFun(fi)) {
                goog.array.remove(functionStack_, fi);
            }
        }
        if (functionStack_.length == 0 && j != 0) {
           goog.array.remove(this.taskStack_, task);
        }
    }
    // if no more functions: stop timers
    if (this.taskStack_.length == 1 &&
            this.taskStack_[0].functionStack_.length == 0) {
        lime.scheduleManager.disable_();
    }
};

/**
 * Start the internal timer functions
 * @this {lime.scheduleManager}
 * @private
 */
lime.scheduleManager.activate_ = function() {
    if (this.active_) return;

    // There are serious freezes on startup so its better to wait for first event loop.
    if (this.started_) this.activate__();
    else setTimeout(goog.bind(this.activate__, this), 0);

    this.started_ = true;

    this.active_ = true;
};

/**
 * Add JSDoc tag to avoid warning. by gsyan
 * @this {lime.scheduleManager}
 */
lime.scheduleManager.activate__ = function() {
    this.lastRunTime_ = this.now();

    if(lime.scheduleManager.USE_ANIMATION_FRAME && goog.global.requestAnimationFrame) {
        // old mozilla
        if(goog.global['mozRequestAnimationFrame'] && goog.userAgent.VERSION < 11) {
            goog.global['mozRequestAnimationFrame']();
            this.beforePaintHandlerBinded_ = goog.bind(lime.scheduleManager.beforePaintHandler_,this);
            goog.global.addEventListener('MozBeforePaint',this.beforePaintHandlerBinded_, false);
        }
        else {
            this.animationFrameHandlerBinded_ = goog.bind(lime.scheduleManager.animationFrameHandler_,this);
            this.requestID_ = goog.global.requestAnimationFrame(this.animationFrameHandlerBinded_);
        }
    }
    else {
        this.intervalID_ = setInterval(goog.bind(lime.scheduleManager.stepTimer_, this),
            lime.scheduleManager.getDisplayRate());
    }
};

(function() {

var performance = goog.global['performance']
var now = performance && (performance['now'] || performance['webkitNow'])

lime.scheduleManager.now = function() {
    return now ? now.call(performance) : goog.now();
};

})();

/**
 * Stop interval timer functions
 * @this {lime.scheduleManager}
 * @private
 */
lime.scheduleManager.disable_ = function() {
    if (!this.active_) return;

    if(lime.scheduleManager.USE_ANIMATION_FRAME && goog.global.requestAnimationFrame) {
        // old mozilla
        if(goog.global['mozRequestAnimationFrame'] && goog.userAgent.VERSION < 11) {
            goog.global.removeEventListener('MozBeforePaint',this.beforePaintHandlerBinded_, false);
        }
        else {
            goog.global.cancelAnimationFrame(this.requestId_);
        }
    }
    else {
        clearInterval(this.intervalID_);
    }
    this.active_ = false;
};

/**
 * Webkit implemtation of requestAnimationFrame handler.
 * @this {lime.scheduleManager}
 * @private
 */
lime.scheduleManager.animationFrameHandler_ = function(){
    var time = this.now();
    var delta = time - this.lastRunTime_;
    if (delta < 0) { // i0S6 reports relative to the device restart time. So first is negative.
        delta = 1;
    }
    lime.scheduleManager.dispatch_(delta);
    this.lastRunTime_ = time;
    this.requestId_ = goog.global.requestAnimationFrame(this.animationFrameHandlerBinded_);
}

/**
 * Mozilla < 11 implementation of requestAnimationFrame handler.
 * @this {lime.scheduleManager}
 * @private
 */
lime.scheduleManager.beforePaintHandler_ = function(event){
    var delta = event.timeStamp - this.lastRunTime_;
    lime.scheduleManager.dispatch_(delta);
    this.lastRunTime_ = event.timeStamp;
    goog.global['mozRequestAnimationFrame']();
}

/**
 * Timer events step function that delegates to other objects waiting
 * @this {lime.scheduleManager}
 * @private
 */
lime.scheduleManager.stepTimer_ = function() {
    var t;
    var curTime = this.now();
    var delta = curTime - this.lastRunTime_;
    if (delta < 0) delta = 1;
    lime.scheduleManager.dispatch_(delta);
    this.lastRunTime_ = curTime;
};

/**
 * Call all scheduled tasks
 * @this {lime.scheduleManager}
 * @param {number} delta Milliseconds since last run.
 * @private
 */
lime.scheduleManager.dispatch_ = function(delta){


    var stack = this.taskStack_.slice()
    var i = stack.length;
    while (--i >= 0) stack[i].step_(delta);
    //hack to deal with FF4 CSS transformation issue https://bugzilla.mozilla.org/show_bug.cgi?id=637597
    if(lime.transformSet_ == 1 && (/Firefox\/18./).test(goog.userAgent.getUserAgentString()) &&
       !lime.FF4_USE_HW_ACCELERATION){
        if(lime.scheduleManager.odd_){
            document.body.style['MozTransform'] = '';
            lime.scheduleManager.odd_=0;
        }
        else {
            document.body.style['MozTransform'] = 'scale(1,1)';
            lime.scheduleManager.odd_=1;
        }
        lime.transformSet_=0;
    }
};

/**
 * Change director's activity. Used for pausing updates when director is paused
 * @this {lime.scheduleManager}
 * @param {lime.Director} director Director.
 * @param {boolean} value Active or inactive?
 */
lime.scheduleManager.changeDirectorActivity = function(director, value) {
    var t, context, f, d, i,
    j = this.taskStack_.length;
    while (--j >= 0) {

        t = this.taskStack_[j];
        i = t.functionStack_.length;
        while (--i >= 0) {
            f = t.functionStack_[i];
            context = f.ctx;
            if (goog.isFunction(context.getDirector)) {
                d = context.getDirector();
                if (d == director) {
                    f.paused = !!value
                }
            }
        }
    }
};

/**
 * Set up function to be called once after a delay
 * @param {function(number)} f Function to be called.
 * @param {Object} context Context used when calling object.
 * @param {number} delay Delay before calling.
 */
lime.scheduleManager.callAfter = function(f, context, delay) {
    lime.scheduleManager.scheduleWithDelay(f, context, delay, 1);
};

/**
 * Set up function to be called repeatedly after a delay
 * @param {function(number)} f Function to be called.
 * @param {Object} context Context used when calling object.
 * @param {number} delay Delay before calling.
 * @param {number=} opt_limit Number of times to call.
 * @this {lime.scheduleManager}
 */
lime.scheduleManager.scheduleWithDelay = function(f, context,
        delay, opt_limit) {
    var task = new lime.scheduleManager.Task(delay, opt_limit);
    lime.scheduleManager.schedule(f, context, task);
};
