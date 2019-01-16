/**
 * @class HApi $Api
 */

var IoBApi = (function () {
    var STATUS_LOADING = 1;
    var STATUS_OPENED = 2;
    var STATUS_READY = 3;
    var STATUS_ERROR = 4;
    var STATUS_CLOSED = 5;

    function $Api () {
        this._conn = window.servConn;

        this._listeners = {
            error: [],
            message: [],
            ready: [],
            unready: []
        };

        this._subscribes = {};
        this._requests = [];
        this._requestsing = [];
        this._objects = {};
        this.language = null;

        this._init();
    }

    $Api.prototype._init = function () {
        this._connect();
    };

    $Api.prototype.on = function (key, callback) {
        var self = this;

        if(this._listeners[key].indexOf(callback) !== -1) {
            return function () {}
        }

        this._listeners[key].push(callback);

        return function () {
            self._listeners[key] = self._listeners[key].filter(function (a) {
                return a !== callback;
            });
        }
    };

    $Api.prototype.onError = function (callback) {
        return this.on('error', callback)
    };
    $Api.prototype.onMessage = function (callback) {
        return this.on('message', callback)
    };
    $Api.prototype.onReady = function (callback) {
        if(this.status === STATUS_READY) {
            try {
                callback({status: STATUS_READY});
            }
            catch (e) {}
        }

        return this.on('ready', callback)
    };
    $Api.prototype.onUnready = function (callback) {
        return this.on('unready', callback)
    };

    $Api.prototype.send = function (data, callback) {
        // var wsData = JSON.stringify(data);
        var self = this;
        console.log('Send: ' + JSON.stringify(data));
        //Send: {"type":"call_service","domain":"homeassistant","service":"toggle","service_data":{"entity_id":"sonoff.0.siemens150432467.alive"}}
        if (data.type === 'call_service') {
            var id = data.service_data.entity_id;
            if (data.service === 'toggle') {
                self._conn.getStates([id], function (err, states) {
                    self._conn.setState(id, states[id] ? !states[id].val : true, function (err, state) {
                        callback && callback();
                    });
                });
            } else if (data.service === 'volume_set') {
                self._conn.setState(id, data.service_data.value, function (err) {
                    callback && callback();
                });
            } else if (data.service === 'trigger' || data.service === 'turn_on') {
                self._conn.setState(id, true, function (err) {
                    callback && callback();
                });
            } else if (data.service.match(/^set_/) && data.service !== 'set_datetime') {
                // set_value          => service_data.value
                // set_operation_mode => service_data.operation_mode
                // set_temperature    => service_data.temperature
                // set_speed          => service_data.speed
                self._conn.setState(id, data.service_data[data.service.substring(4)], function (err) {
                    callback && callback();
                });
            } else if (data.service === 'volume_mute') {
                // volume_mute        => service_data.is_volume_muted
                self._conn.setState(id, data.service_data.is_volume_muted, function (err) {
                    callback && callback();
                });
            }  else if (data.service.match(/^select_/)) {
                // select_option      => service_data.option
                // select_source      => service_data.source
                self._conn.setState(id, data.service_data[data.service.substring(7)], function (err) {
                    callback && callback();
                });
            } else {
                // close_cover, open_cover
                // set_datetime       => service_data.date, service_data.time
            }
        }
    };

    $Api.prototype.subscribeEvents = function (events, callback) {
        var self = this;
        if(events && typeof events === 'object') {
            events.forEach(function (event) {
                self.subscribeEvent(event, callback);
            })
        } else {
            this.subscribeEvent(events, callback);
        }
    };

    $Api.prototype.subscribeEvent = function (event, callback) {
        // console.log('subscribeEvent: ' + JSON.stringify(event));

        // The states will be subscribed one by one to get better performance in getState
    };

    $Api.prototype._iob2hass = function (id, state) {
        state = state || {};
        var common = this._objects[id] ? this._objects[id].common || {} : {};
        try {
            return {
                entity_id: id,
                attributes: {
                    unit_of_measurement: common.unit !== undefined ? common.unit : null,
                    max: common.max !== undefined ? common.max : null,
                    min: common.min !== undefined ? common.min : null,
                    step: common.step !== undefined ? common.step : null,
                    min_temp: common.min !== undefined ? common.min : null,
                    max_temp: common.max !== undefined ? common.max : null,
                    friendly_name: common.name !== undefined ? (typeof common.name === 'object' ? common.name[this.language] || common.name.en : common.name): null,
                    temperature: common.role && common.role.match(/temperature/) ? state.val : null,
                    target_temp_low: common.min !== undefined ? common.min : null,
                    target_temp_high: common.max !== undefined ? common.max : null,
                    value: state.val,
                    volume_level: common.role && common.role.match(/volume/) ? state.val : null,
                    brightness: common.role && common.role.match(/brightness/) ? state.val : null,
                    target_temp_step: common.step !== undefined ? common.step : null,

                    entity_picture: null,
                    longitude: null,
                    latitude: null,
                    bgStyles: null,
                    has_date: null,
                    has_time: null,
                },
                state: state.val,
                last_changed: new Date(state.lc),
                last_updated: new Date(state.ts),
                q: state.q,
            };
        } catch (e) {
            return null;
        }
    };

    $Api.prototype.getStates = function (callback) {
        // The states will be read one by one to get better performance in getState
        callback && callback({success: true, result: []});
    };

    $Api.prototype._getObjects = function (ids, callback, _result) {
        var self = this;
        _result = _result || {};

        if (!ids || !ids.length) {
            callback && callback(_result);
        } else {
            var id = ids.shift();
            this._conn.getObject(id, function (err, obj) {
                if (obj) {
                    _result[id] = obj;
                }
                setTimeout(function () {
                    self._getObjects(ids, callback, _result);
                }, 0);
            });
        }
    };

    $Api.prototype.getState = function (id) {
        var self = this;

        if (this._requests.indexOf(id) !== -1) return;
        if (this._requestsing.indexOf(id) !== -1) return;

        // aggregates requests together in 100ms slices
        this._requests.push(id);

        // do not create timer if yet running
        if (this._requestTimeout) return;

        this._requestTimeout = setTimeout(function () {
            self._requestTimeout = null;
            var requests = self._requests;
            requests.forEach(function (id){ return self._requestsing.push(id);});

            self._requests = [];

            self._getObjects(JSON.parse(JSON.stringify(requests)), function (objs) {
                requests.forEach(function (id) {
                    if (objs[id]) {
                        self._objects[id] = objs[id];
                    }
                });

                self._conn.getStates(requests, function (err, states) {
                    var subscribes = [];
                    var data = [];
                    objs = objs || {};
                    requests.forEach(function (id) {
                        var pos = self._requestsing.indexOf(id);
                        if (pos !== -1) {
                            self._requestsing.splice(pos, 1);
                        }
                        if (states[id]) {
                            if (!self._subscribes[id]) {
                                self._subscribes[id] = true;
                                subscribes.push(id);
                            }
                            data.push({
                                entity_id: id,
                                new_state: self._iob2hass(id, states[id])
                            });
                        } else {
                            self._setStatus(STATUS_ERROR);
                            self._sendError.call(self, 'Entity "' + id + '" not found');
                        }
                    });

                    if (data.length) {
                        self._handleMessage.call(self, {
                            type: 'event',
                            event: {
                                event_type: 'state_changed',
                                data: data
                            }
                        });
                    }

                    if (subscribes.length) {
                        console.log('Subscribe ' + subscribes.join(', '));
                        self._conn.subscribe(subscribes);
                    }

                });
            });
        }, 100);
    };

    // not used
    $Api.prototype.getPanels = function (callback) {
        return callback && callback('not implemented');
        // return this.send({type: 'get_panels'}, callback);
    };

    // not used
    $Api.prototype.getConfig = function (callback) {
        return callback && callback('not implemented');
        //return this.send({type: 'get_config'}, callback);
    };

    // not used
    $Api.prototype.getServices = function (callback) {
        return callback && callback('not implemented');
        //return this.send({type: 'get_services'}, callback);
    };

    // not used
    $Api.prototype.getUser = function (callback) {
        return callback && callback('not implemented');
        // return this.send({type: 'auth/current_user'}, callback);
    };

    $Api.prototype._connect = function () {
        var self = this;

        this.status = STATUS_LOADING;
        this._conn.init(null, {
            onConnChange: function (isConnected) {
                if (isConnected) {
                    if (!self.language) {
                        self._conn.getConfig(function (err, config) {
                            self.language = config.language;
                            self._setStatus(STATUS_OPENED);
                            self._ready();
                        });
                    } else {
                        self._setStatus(STATUS_OPENED);
                        self._ready();
                    }
                } else {
                    self._setStatus(STATUS_CLOSED);
                }
            },
            onRefresh:    function () {
                window.location.reload();
            },
            onUpdate:     function (id, state) {
                self._handleMessage.call(self, {
                    type: 'event',
                    event: {
                        event_type: 'state_changed',
                        data: {
                            entity_id: id,
                            new_state: self._iob2hass(id, state)
                        }
                    }
                });
            },
            onAuth:       function (message, salt) {
                console.log('todo');
            },
            onError:      function (err) {
                self._setStatus(STATUS_ERROR);
                self._sendError.call(self, 'System error', err);

                if (err.arg === 'vis.0.control.instance' || err.arg === 'vis.0.control.data' || err.arg === 'vis.0.control.command') {
                    console.warn('Cannot set ' + err.arg + ', because of insufficient permissions');
                }
            }
        }, false, false);
    };

    $Api.prototype._fire = function (key, data) {
        this._listeners[key].forEach(function (cb) {
            setTimeout(function () { cb(data) }, 0);
        })
    };

    $Api.prototype._handleMessage = function (data) {
        var self = this;
        /*if(data.type === 'auth_required') return this._authenticate();
        if(data.type === 'auth_invalid') return this._authInvalid(data.message);
        if(data.type === 'auth_ok') return this._ready();*/

        //if(data.error) return this._sendError(data.error.message, data);

        /*if(data.type === 'result' && data.id) {
            if(this._callbacks[data.id]) {
                setTimeout(function () {
                    self._callbacks[data.id](data);
                }, 0);
            }
        }*/

        this._fire('message', data);
    };

    $Api.prototype._sendError = function (message, data) {
        var msg = {message: message};

        if(data) msg.data = data;

        this._fire('error', msg);
    };

    $Api.prototype._ready = function () {
        this._setStatus(STATUS_READY);
        this._fire('ready', {status: STATUS_READY});
    };

    $Api.prototype._setStatus = function (status) {
        this.status = status;
    };

    return $Api;
}());