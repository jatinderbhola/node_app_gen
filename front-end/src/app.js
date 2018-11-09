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

                $stateProvider
                    .state({
                        name: "app",
                        url: "/",
                        views: {
                            'menue': { templateUrl: 'home/menu_template.ejs' },
                        }
                    })
                    .state('report', {
                        views: {
                            'menue': { templateUrl: 'home/menu_template.ejs' }
                        }
                    })

                $stateProvider.state({
                    name: "menu",
                    url: "/meun",
                    templateUrl: 'home/menu.ejs'
                });
                $stateProvider.state({
                    name: "home",
                    url: "/home",
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