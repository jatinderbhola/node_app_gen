(function() {
    'use strict';
    angular.module('app', [
            'ngMaterial',
            'ngMdIcons',
            'ui.router',
            'ngResource',
        ])
        .config(['$stateProvider',
            function($stateProvider) {

                $stateProvider.state({
                    name: "app",
                    url: "/home",
                    views: {
                        'home': { controller: 'timerCtrl', templateUrl: 'home.ejs' },
                        '@': { controller: 'tabCtrl', templateUrl: 'top.html' }
                    }
                });

                $stateProvider.state({
                    name: "menu",
                    url: "/meun",
                    templateUrl: 'home/menu.ejs'
                });
                $stateProvider.state({
                    name: "home",
                    url: "/",
                    templateUrl: 'home/home.ejs'
                });
                $stateProvider.state({
                    name: "menu2",
                    url: "/meun2",
                    templateUrl: 'home/menu2.ejs'
                });
            }
        ])
}());