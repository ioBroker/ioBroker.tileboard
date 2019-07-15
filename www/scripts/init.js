var App = angular.module('App', ['pr.longpress', 'colorpicker']);

App.config(function($sceProvider) {
   $sceProvider.enabled(false);
});

App.config(function($locationProvider) {
   $locationProvider.html5Mode({
      enabled: true,
      requireBase: false
   });
});


if(!window.CONFIG) {
   var error = 'Please make sure you have "config.js" file and it\'s a valid javascript!\n' +
      'If you running TileBoard for the first time, please rename "config.example.js" to "config.js"';

   alert(error);
}

// small fix for new parameter (IoB)
if (window.CONFIG) {
    window.CONFIG.serverUrl = window.CONFIG.serverUrl || '';
}

var Api = typeof HApi !== 'undefined' ? new HApi(CONFIG.wsUrl, CONFIG.authToken) : new IoBApi();
