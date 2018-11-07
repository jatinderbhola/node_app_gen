(function() {
    'use strict';
    angular.module('app')

    .controller('MainController', ['$scope',
        'RugSession',
        'ObjectUtils',
        '$http',
        '$state',
        '$log',
        '$mdSidenav',
        '$mdMedia',
        'toastService',
        '_',
        '$mdToast',
        function($scope,
            rugSession,
            ObjectUtils,
            $http,
            $state,
            $log,
            $mdSidenav,
            $mdMedia,
            toastService,
            _,
            $mdToast) {

            if (!rugSession.isAuthenticated()) {
                rugSession.logout();
            }

            $state.go('auth');

            //checking for any yelling from child room (emit messaged by some child)
            $scope.$on('speedDial', function(event, receivedText, receivedVal) {
                event = event || null;
                receivedVal = receivedVal || null;
                if (receivedText === "EditOrUpdate" || receivedText === "disable") {
                    speedDialActive = false;
                } else {
                    speedDialActive = true;
                }
            });

            //to prevent state change if app is busy doing something imp like uploading.
            $scope.$on('stateStatus', function(event, receivedText, receivedVal) {
                if (receivedText === "busy") {
                    $scope.stateStatusActive = false;
                } else {
                    $scope.stateStatusActive = true;
                }
                $scope.stateStatusMessage = receivedVal;
            });
            var themeActive = false;
            var shortSideBarActive = false;
            var speedDialActive = false;
            $scope.stateStatusActive = true;
            $scope.backbroundColor = 'default-primary-900';
            $scope.companyName = '';

            // this function control the visiblity of md-sideNav, md-toolbar, speed dial on *.ejs files
            if (rugSession.isAuthenticated()) {
                themeActive = true;
                speedDialActive = true;
            }

            $scope.isThemeActive = function() { // control the visibility of toolbar, sidebar (not the short side bar) and speed-dial
                if (rugSession.isAuthenticated()) {
                    themeActive = true;
                    return themeActive;
                }
                return false;
            };

            $scope.isShortSideBarActive = function() { //control the visibility of short side bar
                if (rugSession.isAuthenticated()) {
                    return shortSideBarActive;
                }
                return false;
            };

            $scope.isSpeedDialActive = function() { //control the visibility of speed dial
                return speedDialActive;
            };

            // --- sidenav toggle ---
            $scope.toggleLeftSideBar = function() {

                if ($mdMedia('gt-sm')) { // if the screen size is >=960 then on clicking the menu button it change the sideBar to short-sidebar.
                    var element = document.getElementById('left-side-bar');
                    if (element.classList.contains('md-locked-open')) { // if true: means sideBar is active
                        element.classList.remove("md-locked-open");
                        shortSideBarActive = true;
                        // $scope.appMenuIcon = 'menu';
                    } else {
                        element.classList.add("md-locked-open");
                        shortSideBarActive = false;
                        // $scope.appMenuIcon = 'keyboard_arrow_left';
                    }
                } else { //smaller size screens
                    $mdSidenav('left').toggle();
                }
            };

            $scope.login = function() {
                window.location = '/' + $scope.companyName + '/#/';
            };

            // control the sidebars when screen size changed
            $scope.$watch(function() { return $mdMedia('gt-sm'); }, function(isBig) {
                if (isBig) {
                    // $scope.appMenuIcon = 'keyboard_arrow_left';
                    shortSideBarActive = false;
                } else {
                    // $scope.appMenuIcon = 'menu';
                    shortSideBarActive = false;
                }
            });


            //  close side nav NOT USING!!
            $scope.closeSideNav = function() {
                // Component lookup should always be available since we are not using `ng-if`
                $mdSidenav('left').close()
                    .then(function() {
                        $log.debug("close RIGHT is done");
                    });
            };

            //  close side nav NOT USING!!
            $scope.closeSideNav = function() {
                // Component lookup should always be available since we are not using `ng-if`
                $mdSidenav('left').close()
                    .then(function() {
                        $log.debug("close RIGHT is done");
                    });
            };

            $scope.gotoState = function(newState) {
                if ($scope.stateStatusActive) {
                    $state.go(newState);
                } else {
                    var toast = $mdToast.simple()
                        .textContent($scope.stateStatusMessage + "Click to change state")
                        .action('forcefully')
                        .highlightAction(true)
                        .highlightClass('md-accent') // Accent is used by default, this just demonstrates the usage.
                        .position('bottom right');

                    $mdToast.show(toast).then(function(response) {
                        console.log(response);
                        if (response == 'ok') {
                            $scope.stateStatusActive = true;
                            $state.go(newState);
                        } else {
                            toastService.serverError($scope.stateStatusMessage);
                        }
                    });

                }
                if (!$mdMedia('gt-sm') && $mdSidenav('left').isOpen()) { // if the screen size is >=960 then on clicking the menu button it change the sideBar to short-sidebar.
                    $mdSidenav('left').toggle();
                }
                // $scope.toggleLeft();
            };

            // --- LOGOUT CALL ----
            $scope.logoutCall = function() {
                themeActive = false;
                rugSession.setAuthenticated(false);
                $http.get("api/logout").then(function(response) {
                    if (response) {
                        $state.go('auth');
                    }
                });
            };


            //display full user name on the toolbar
            $scope.getUsernameFromJson = function() {
                var _username = rugSession.getUser();
                return _username.first_name + " " + _username.last_name;
            };


            // --- load staff on clicking load profile ---
            $scope.loadStaff = function() {
                var staff = rugSession.getUser();
                $scope.result = $scope.parseStaff(staff);
                staff.name = staff.first_name + " " + staff.last_name;
                $state.go("staff-edit", { staffId: staff._id, staff: staff });
            };

            $scope.parseStaff = function(rawStaff) {
                var staff = rawStaff;
                if (ObjectUtils.isObject(rawStaff)) {
                    for (var p in rawStaff) {
                        if (p == "date_of_birth") {
                            if (ObjectUtils.isNonEmptyString(rawStaff.date_of_birth)) {
                                staff.date_of_birth = new Date(rawStaff.date_of_birth);
                            }
                        } else {
                            staff[p] = rawStaff[p];
                        }
                    }
                }
                return staff;
            };
            // --- END! load staff on clicking load profile —

            $scope.openSettings = function() {
                var user = rugSession.getUser();
                if (ObjectUtils.isObject(user) && ObjectUtils.isObject(user.portal)) {
                    var portal = user.portal;
                    if (portal.payroll && portal.payroll.current_period_start && ObjectUtils.isNonEmptyString(portal.payroll.current_period_start)) {
                        portal.payroll.current_period_start = new Date(portal.payroll.current_period_start);
                    }
                    $state.go("portal-settings", { portal: portal });
                }
            };

            // speed dial
            $scope.quickFabMenu = [{
                    label: 'Add a new order',
                    tooltip: 'New Order',
                    icon: 'border_all',
                    link: "order-edit"
                },
                {
                    label: 'staff',
                    tooltip: 'New Staff',
                    icon: 'account_circle',
                    link: "staff-edit"
                },
                {
                    label: 'customers',
                    tooltip: 'New Customer',
                    icon: 'account_circle',
                    link: "customer-edit"
                }
            ];

            $scope.leftSideBar = [{
                    link: 'dashboard',
                    title: 'Dashboard',
                    icon: 'dashboard'
                },
                {
                    link: 'customers',
                    title: 'Customers',
                    icon: 'person_pin'
                },
                {
                    link: 'appraisals-list',
                    title: 'Appraisals',
                    icon: 'art_track'
                },
                {
                    link: 'showroom-view',
                    title: 'Showroom',
                    icon: 'room_service'
                },
                {
                    link: 'report-module',
                    title: 'reports',
                    icon: 'assessment'
                }
                // {
                //     link: 'showroom-order-list',
                //     title: 'Showroom Order',
                //     icon: 'room_service'
                // },
                // {
                //     link: 'consignment',
                //     title: 'Consignment',
                //     icon: 'room_service'
                // }

            ];

            $scope.menu = [

                {
                    link: 'staff',
                    title: 'Staff',
                    icon: 'person_pin'
                },
                {
                    link: 'timesheet',
                    title: 'Timesheet',
                    icon: 'schedule'
                },
                {
                    link: 'no-work-log',
                    title: 'No work log',
                    icon: 'comment'
                },
                {
                    link: 'service-entries',
                    title: 'Service Entries',
                    icon: 'group_work'
                },
                {
                    link: 'commission-batch-sheets',
                    title: 'Commission Batch sheets',
                    icon: 'group_work'
                },
                {
                    link: 'commission-batch-sheet-entries',
                    title: 'Commission Batch sheet Entries',
                    icon: 'group_work'
                },
                {
                    link: 'commission-entries',
                    title: 'Commission Entries',
                    icon: 'group_work'
                },
                {
                    link: 'commission-runs',
                    title: 'Commission Run',
                    icon: 'group_work'
                },
                {
                    link: 'services',
                    title: 'Products and Services',
                    icon: 'group_work'
                },
                {
                    link: 'service-categories',
                    title: 'Products and Service Categories',
                    icon: ''
                }
            ];


            $scope.user = [{
                    link: '',
                    linkFn: 'loadStaff',
                    title: 'Profile',
                    icon: ''
                },
                {
                    link: '',
                    linkFn: 'logoutCall',
                    title: 'Logout',
                    icon: ''
                },
            ];

            $scope.settings = [{
                    link: '',
                    linkFn: 'openSettings',
                    title: 'Global Settings',
                    icon: ''
                }, {
                    link: 'accounting-system',
                    title: 'Accounting System',
                    icon: ''
                },
                {
                    link: 'service-uom',
                    title: 'UOM',
                    icon: ''
                },
                {
                    link: 'departments',
                    title: 'Departments',
                    icon: ''
                },
                {
                    link: 'positions',
                    title: 'Position',
                    icon: ''
                },
                {
                    link: 'workflow-stages',
                    title: 'Workflow Stages',
                    icon: 'group_work'
                },
                {
                    link: 'commission-schemes',
                    title: 'Commission Schemes',
                    icon: 'group_work'
                },
                {
                    link: 'select-app-mode-and-location',
                    title: 'App Mode',
                    icon: 'group_work'
                },
                {
                    link: 'tax-types',
                    title: 'Tax Type',
                    icon: 'group_work'
                },
                {
                    link: 'terms',
                    title: 'Terms',
                    icon: 'group_work'
                },
                {
                    link: 'discounts-list',
                    title: 'Discounts',
                    icon: 'group_work'
                },
                {
                    link: 'no-work-log',
                    title: 'No work log',
                    icon: 'comment'
                },

                {
                    link: 'lists-edit',
                    title: 'List Maintenance',
                    icon: ''
                },
                {
                    link: 'roles',
                    title: 'Roles',
                    icon: ''
                },
                {
                    link: 'zone-a',
                    title: 'Zone A',
                    icon: ''
                },
                {
                    link: 'zone-b',
                    title: 'Zone B',
                    icon: ''
                },
                //showroom link goes here
                {
                    link: 'lists-edit-showroom',
                    title: 'Showroom List Maintenance',
                    icon: ''
                }
            ];

            // this function check the upcoming (argument) state value and differentiate if it is a function or a state name
            $scope.checkLink = function(item) {
                if (_.isObject(item)) {
                    if (_.isString(item.linkFn)) { // if link is a function
                        $scope[item.linkFn]();
                    } else {
                        $scope.gotoState(item.link); //if link is a state name
                    }
                } else {
                    toastService.serverError("Link is missing.");
                }
            };
        }
    ]);
}());