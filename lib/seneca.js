/* Copyright (c) 2010-2011 Ricebridge */

var common  = require('./common')

var util    = common.util
var assert  = common.assert
var uuid    = common.uuid
var _       = common._
var eyes    = common.eyes


var PropMap = require('./propmap').PropMap
var Entity  = require('./entity').Entity


var core = {}

function noopservice( req, res, next ) {
  next && next()
}


function Seneca(opts) {
  var self = this
  self.version = '0.2.1'

  self.$ = {}

  self.options = (opts && opts.options) || {}
  self.options.args = self.options.args || {}

  var logger = opts && opts.logger

  var log = function(type) {
    if( logger ) {
      var args = Array.prototype.slice.call(arguments,1)
      args.unshift(type)
      args.unshift(new Date())
      logger.apply(self,args)
    }
  }

  self.log = function(){
    var args = Array.prototype.slice.call(arguments)
    log.apply(self,args)
  }

  log('start')

  self.$.entity = (opts && opts.entity)

  if( !self.$.entity ) {
    Entity.init$('mem',function(err,mement){
      self.$.entity = mement
      entitylogger(self.$.entity)
    })
  }
  else {
    entitylogger(self.$.entity)
  }
  
  function entitylogger(entity) {
    entity.logger$(function(){
      var args = Array.prototype.slice.call(arguments)
      args.unshift(entity.$.store$().name)
      args.unshift('entity')
      log.apply(self,args)
    })
  }

  // all optional
  self.make = function() {
    return self.$.entity.make$.apply(self,arguments)
  }
  self.make$ = self.make



  // pluginname, opts, callback(err,{req:,res:,next:,...})
  self.service = function( pluginname ) {
    var plugin = core.plugins[pluginname]
    if( !plugin ) {
      throw {err:'plugin_unknown',name:pluginname}
    }
    var args = Array.prototype.slice.call(arguments,1)
    var service = plugin.service.apply(plugin,args) || noopservice
    return service
  }


  self.add = function(args,actfunc) {
    log&&log('add',args)
    // FIX: should be called previous
    var parent = self.findact(args)
    actfunc.parent = parent
    actionpropmap.add(args,actfunc);
  }
  
  
  self.findact = function(args) {
    args.zone = args.zone || 'action';
    var actfunc = actionpropmap.find(args)
    return actfunc
  }

  self.act = function(args,cb) {
    var self = this
    args = _.extend(args,self.options.args)

    var actfunc = self.findact(args)
    if( !actfunc ) {
      cb && cb({err:'act_unknown',args:args})
    }
    else {
      var tag; 
      log && 
        (tag = uuid().substring(0,4)) && 
        log('act','in',args.zone,tag, actfunc.argslog ? actfunc.argslog(args) : args )

      // FIX: this should be called previous$
      args.parent$ = actfunc.parent

      try {
        actfunc(args,self,function(){
          var err = arguments[0]
          log&&log.apply(self,_.flatten(['act','out',args.zone,tag,err,Array.prototype.slice.call(arguments,1)]))
          cb && cb.apply(self,arguments)
        })
      }
      catch( ex ) {
        log&&log.apply(self,_.flatten(['act','err',args.zone,tag,ex,Array.prototype.slice.call(arguments,1)]))
        cb && cb({err:'act_exception',ex:ex,args:args})
      }

    }
  }


  self.pin = function(args) {
    var pinned = Object.create(self)
    pinned.options = _.extend({},self.options)
    pinned.options.args = _.extend(args||{},self.options.args)
    return pinned
  }

  
  self.cmd = function(cmd,args,cb){
    var self = this
    self.act(_.extend({cmd:cmd},args),cb)
  }
  


  self.close = function(cb){
    log('close')
    if( self.$.entity ) {
      self.$.entity.close$(cb)
    }
  }


  var actionpropmap = new PropMap();

}


// entity can be null
Seneca.init = function( entity ) {
  var seneca = new Seneca();
  seneca.init(entity);
  return seneca;
}




module.exports = function(entity) {  return new Seneca(entity) }
module.exports.Seneca = Seneca
module.exports.Entity = Entity


function printlogger() {
  function own(obj){
    if( obj ) {
      var sb = ['{']
      for( var p in obj ) {
        if( obj.hasOwnProperty(p) ) {
          sb.push(p)
          sb.push('=')
          sb.push(obj[p])
          sb.push(',')
        }
      }
      sb.push('}')
      return sb.join('')
    }
    else {
      return null
    }
  }

  var args = Array.prototype.slice.call(arguments)

  var argstrs = []
  args.forEach(function(a){
    argstrs.push(
      null==a?a:
        'string'==typeof(a)?a:
        _.isDate(a)?(a.getTime()%1000000):
        a.hasOwnProperty('toString')?''+a:own(a)
    )
  })
  util.debug( argstrs.join('\t') )
}


// FIX: better error handling - should all go through callback
/*
opts.logger: logger function
opts.entity: entity object
opts.plugins: plugins list
opts.options: {logger:,entity:,plugins:{<name>:,...}}
*/
module.exports.init = function(opts,cb) {
  if( 'function' != typeof(cb) ) {
    throw {err:'no_callback'}
  }

  var logger = opts.logger
  if( 'print' == logger ) {
    logger = printlogger
  }

  var entity = opts.entity
  if( 'string' == typeof(entity) || entity.store ) {
    Entity.init$(entity,function(err,entity) {
      if( err ) {
        logger && logger('error',err)
        cb(err)
      }
      else {
        newseneca(entity)
      }
    })
  }
  else {
    newseneca(entity)
  }


  function newseneca(entity) {

    var seneca = new Seneca({
      logger:logger,
      entity:entity,
      options:opts.options
    })

    initplugins(seneca,function(err){
      cb(err,err?null:seneca)
    })
  }


  function initplugins(seneca,cb) {
    var plugins = opts.plugins || []

    function loadplugin( pluginname ) {
      seneca.log('plugin','load',pluginname)

      plugin = core.plugins[pluginname]
        
      if( !plugin ) {
        var pluginRoot 
        try {
          pluginRoot = require('./plugin/'+pluginname+'.js')
        }
        catch( e ) {
          pluginRoot = require('./plugin/'+pluginname+'/'+pluginname+'.js')
        }
        plugin = pluginRoot.plugin()
        core.plugins[pluginname] = plugin
      }

      return plugin
    }

    function eachplugin(pI) {
      if( pI < plugins.length ) {
        try {
          var pluginname = plugins[pI]
          var pluginopts = {}

          if( 'object' == typeof(pluginname) ) {
            var plugindesc = pluginname
            pluginname = plugindesc.name
            pluginopts = plugindesc.options
          }

          var plugin = loadplugin( pluginname )

          if( plugin ) {
            seneca.log('plugin','init',pluginname,pluginopts)
            plugin.init(seneca,pluginopts,function(err){
              if( err ) {
                seneca.log('plugin','init','error',err,pluginname,pluginopts)
                cb(err)
              }
              else eachplugin(pI+1);
            })
          }
          else {
            cb({err:'unknown_plugin',pluginname:pluginname})
          }
        }
        catch( e ) {
          cb(e)
        }
      }
      else if( pI == plugins.length ) {
        cb(null)
      }
    }
    eachplugin(0)
  }

}


core.plugins = {}

module.exports.register = function(spec) {
  var name = spec.name
  var impl = spec.impl

  core.plugins[name] = impl
}



