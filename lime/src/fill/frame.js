goog.provide('lime.fill.Frame');

goog.require('lime.fill.Fill');
goog.require('lime.fill.Image');
goog.require('goog.math.Rect');
goog.require('goog.style');
goog.require('goog.cssom');
goog.require('goog.dom.classes');
goog.require('goog.dom');
goog.require('goog.math.Vec2');
goog.require('goog.math.Size');

/**
 * Image fill.
 * @param {string|Image|lime.Sprite} img Image.
 * @param {goog.math.Rect|number} rect Crop frame.
 * @param {goog.math.Vec2=} opt_offset Frame offset.
 * @param {goog.math.Size=} opt_size Frame size.
 * @param {boolean=} opt_rotated Is frame rotated.
 * @constructor
 * @extends lime.fill.Image
 */
lime.fill.Frame = function(img, rect, opt_offset, opt_size, opt_rotated) {
    lime.fill.Image.call(this,img);

    if(goog.isNumber(rect)){
        rect = new goog.math.Rect(arguments[1],arguments[2],arguments[3],arguments[4]);
        opt_offset = new goog.math.Vec2(0,0);
        opt_size = new goog.math.Size(rect.width,rect.height);
        opt_rotated = false;
    }

    this.rect_ = rect;
    this.coffset_ = opt_offset;
    this.csize_ = opt_size;
    this.rotated_ = opt_rotated;

    var r = this.rect_,key = [this.url_,r.width,r.height,r.left,r.top,this.coffset_.x,this.coffset_.y].join('_');
    if(goog.isDef(this.dataCache_[key])){
        this.data_ = this.dataCache_[key];
        if(!this.data_.processed){
            goog.events.listen(this.data_.initializer,'processed',function(){
                this.dispatchEvent(new goog.events.Event('processed'));
            },false,this);
        }
    }
    else {
        this.data_ = {};
        this.data_.processed = false;
        this.data_.initializer = this;
        this.data_.classname = this.getNextCssClass_();
        this.dataCache_[key] = this.data_;

        if (this.USE_CSS_CANVAS) {
            this.ctx = document.getCSSCanvasContext('2d', this.data_.classname, this.csize_.width, this.csize_.height);
        }
        else {
            this.ctx = this.makeCanvas();
        }

        if(this.isLoaded()){
            this.makeFrameData_();
        }
        else {
            goog.events.listen(this,goog.events.EventType.LOAD,this.makeFrameData_,false,this);
        }
    }
};
goog.inherits(lime.fill.Frame,lime.fill.Image);

/**
 * Common name for Frame objects
 * @type {string}
 */
lime.fill.Frame.prototype.id = 'frame';

/**
 * @private
 */
lime.fill.Frame.prototype.dataCache_ = {};

/**
 * @type {boolean}
 */
lime.fill.Frame.prototype.USE_CSS_CANVAS = goog.isFunction(document.getCSSCanvasContext);

/**
 * @inheritDoc
 */
lime.fill.Frame.prototype.initForSprite = function(sprite){

    var size = sprite.getSize();
    if(size.width==0 && size.height==0){
        sprite.setSize(this.csize_.width,this.csize_.height);
    }

    lime.fill.Image.prototype.initForSprite.call(this,sprite);

    if(!this.isProcessed()){
        goog.events.listen(this,'processed',function(){
            sprite.setDirty(lime.Dirty.CONTENT);
        },false,this);
    }

    //switch to canvas if no support
};

lime.fill.Frame.prototype.isProcessed = function(){
    return this.data_ && this.data_.processed;
};

(function(){

var pfx='cvsbg_'+Math.round(Math.random()*1000)+'_',index=0,styleSheet;

/**
 * @private
 */
lime.fill.Frame.prototype.getNextCssClass_ = function(){
    index++;
    return pfx+index;
}

/**
 * @private
 */
lime.fill.Frame.prototype.makeFrameData_ = function(){
    this.writeToCanvas(this.ctx);

    if(!this.USE_CSS_CANVAS){

        //2022.01.20 modified by gsyan , avoid to break the process
        // DOMException: Failed to execute 'toDataURL' on 'HTMLCanvasElement': Tainted canvases may not be exported
        try {	
            var contents = this.ctx.canvas.toDataURL("image/png");
        }catch(error) { 
            //
        }		
        var rule = '.'+this.data_.classname+'{background-image:url('+contents+') !important}';

        if(!styleSheet) {
            goog.style.installStyles(rule);
            styleSheet = document.styleSheets[document.styleSheets.length-1];
        }
        else {
            goog.cssom.addCssRule(styleSheet,rule);
        }

        // loading into image to avoid flickery onf firefox first load
        this.data_.img = goog.dom.createDom('img');
        this.data_.img.src = contents;

    }

    this.data_.processed = true;
    this.dispatchEvent(new goog.events.Event('processed'));

};

})();

/**
 * @inheritDoc
 */
lime.fill.Frame.prototype.getImageElement = function(){
    if(!this.frameImgCache_){
        if(this.data_.initializer && this.data_.initializer.frameImgCache_){
            this.frameImgCache_ = this.data_.initializer.frameImgCache_;
        }
        else {
            this.frameImgCache_ = this.ctx.canvas;
        }
    }
    return this.frameImgCache_;
};

lime.fill.Frame.prototype.makeCanvas = function(){
    var canvas = goog.dom.createDom('canvas');
    canvas.width = this.csize_.width;
    canvas.height = this.csize_.height;
    return canvas.getContext('2d');
};

lime.fill.Frame.prototype.writeToCanvas = function(ctx){
    var r = this.rect_, w = r.width, h = r.height, l = r.left, t = r.top,ox,oy;
    if(l<0){
        w+=l;
        l=0;
    }
    if(t<0){
        h+=t;
        t=0;
    }
    if(w+l>this.image_.width) w= this.image_.width-l;
    if(h+t>this.image_.height) h= this.image_.height-t;
    if(this.rotated_){
        ctx.rotate(-Math.PI*.5);
        ctx.translate(-this.csize_.height,0);
        ox = this.csize_.height-this.coffset_.y-w;
        oy = this.coffset_.x;
    }
    else {
        ox = this.coffset_.x;
        oy = this.coffset_.y;
    }

    ctx.drawImage(this.image_,l,t,w,h,ox,oy,w,h);
};

/** @inheritDoc */
lime.fill.Frame.prototype.setDOMStyle = function(domEl,shape) {
    if(this.USE_CSS_CANVAS){
        domEl.style['background'] = '-webkit-canvas('+this.data_.classname+')';
    }
    else if(this.data_.classname!=shape.cvs_background_class_){
        goog.dom.classes.add(domEl,this.data_.classname);
        domEl.style['background'] = '';
        if(shape.cvs_background_class_)
        goog.dom.classes.remove(domEl,shape.cvs_background_class_);
        shape.cvs_background_class_ = this.data_.classname;
    }

    this.setDOMBackgroundProp_(domEl,shape);
};

