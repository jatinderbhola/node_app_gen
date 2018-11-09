module.exports = function(grunt) {

    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),

        // jasmine front-end
        jasmine: {
            src: ['front-end/src/**/*.js'],
            options: {
                specs: 'spec/**/*spec.js',
                vendor: [
                    'node_modules/angular/angular.js',
                    'node_modules/angular-route/angular-route.js',
                    'node_modules/angular-mocks/angular-mocks.js',
                    'node_modules/angular-resource/angular-resource.js',
                    'node_modules/angular-material/angular-material.js',
                    'node_modules/angular-material-icons/angular-material-icons.js',
                    'node_modules/angular-messages/angular-messages.min.js',
                    'node_modules/angular-animate/angular-animate.js',
                    'node_modules/angular-messages/angular-messages.js',
                    'node_modules/angular-aria/angular-aria.js',
                    'node_modules/angular-barcode/dist/angular-barcode.js',
                    'node_modules/angular-ui-router/release/angular-ui-router.js',
                    'node_modules/ng-file-upload/dist/ng-file-upload.min.js',
                    'node_modules/underscore/underscore.js',
                    'front-end/lib/e3-core-ui.js',
                    "node_modules/angular-uuid/angular-uuid.js"

                ],
                summary: true,
                junit: {
                    path: "junitreport",
                    consolidate: false
                }
            }
        },

        // jasmine back-end
        jasmine_node: {
            options: {
                forceExit: true,
                match: '.',
                matchall: false,
                extensions: 'js',
                specNameMatcher: 'spec',
                jUnit: {
                    report: true,
                    savePath: "./junitreport/backend/",
                    useDotNotation: true,
                    consolidate: true
                }
            },
            all: ['spec-backend/']

        },

        //concate
        concat: {
            options: {
                separator: ';'
            },
            dist: {
                src: [
                    'front-end/src/*.js',
                    'front-end/src/controllers/**/*.js',
                    'front-end/src/directives/**/*.js',
                    'front-end/src/services/**/*.js',
                    'front-end/src/filters/**/*.js',
                    'front-end/src/components/**/*.js',
                    'front-end/src/shared/**/*.js'
                ],
                dest: 'public/js/<%= pkg.name %>.min.js'
            },
            lib: {
                src: [
                    "node_modules/angular/angular.min.js",
                    "node_modules/angular-route/angular-route.min.js",
                    "node_modules/angular-aria/angular-aria.min.js",
                    "node_modules/angular-animate/angular-animate.min.js",
                    'node_modules/angular-messages/angular-messages.min.js',
                    "node_modules/angular-material/angular-material.min.js",
                    'node_modules/angular-messages/angular-messages.min.js',
                    'node_modules/angular-resource/angular-resource.min.js',
                    'node_modules/angular-barcode/dist/angular-barcode.js',
                    "node_modules/moment/moment.min.js",
                    'node_modules/ng-file-upload/dist/ng-file-upload.min.js',
                    "front-end/lib/e3-core-ui.js",
                    "node_modules/angular-material-icons/angular-material-icons.min.js",
                    "node_modules/angular-ui-router/release/angular-ui-router.min.js",
                    'node_modules/underscore/underscore-min.js',
                    "node_modules/quill/dist/quill.min.js",
                    "node_modules/angular-uuid/angular-uuid.js",
                    "node_modules/jspdf/dist/jspdf.min.js",
                    "node_modules/html2canvas/dist/html2canvas.min.js"

                ],
                dest: 'public/js/libs.min.js'
            },
            lib_debug: {
                src: [
                    "node_modules/angular/angular.js",
                    'node_modules/angular-resource/angular-resource.js',
                    "node_modules/angular-route/angular-route.js",
                    "node_modules/angular-aria/angular-aria.js",
                    "node_modules/angular-animate/angular-animate.js",
                    'node_modules/angular-messages/angular-messages.js',
                    "node_modules/angular-material/angular-material.js",
                    'node_modules/angular-resource/angular-resource.js',
                    'node_modules/angular-messages/angular-messages.js',
                    'node_modules/angular-barcode/dist/angular-barcode.js',
                    "node_modules/moment/moment.js",
                    'node_modules/ng-file-upload/dist/ng-file-upload.js',
                    "front-end/lib/e3-core-ui.js",
                    "node_modules/angular-material-icons/angular-material-icons.js",
                    "node_modules/angular-ui-router/release/angular-ui-router.js",
                    'node_modules/underscore/underscore.js',
                    "node_modules/quill/dist/quill.js",
                    "node_modules/angular-uuid/angular-uuid.js",
                    "node_modules/jspdf/dist/jspdf.debug.js",
                    "node_modules/html2canvas/dist/html2canvas.js"

                ],
                dest: 'public/js/libs.js'
            },
            css: {
                src: [
                    "node_modules/angular-material/angular-material.css",
                    "front-end/lib/e3-core-style.min.css",
                    "front-end/style/app.css"
                ],
                dest: 'public/css/lib.css'
            }
        },

        // uglify
        uglify: {
            options: {
                banner: '/*! <%= pkg.name %> <%= grunt.template.today("dd-mm-yyyy") %> */\n'
            },
            my_target: {
                files: {
                    'public/js/<%= pkg.name %>.min.js': ['<%= concat.dist.dest %>']
                }
            }
        },

        // copy templates
        copy: {
            main: {
                files: [
                    // flattens results to a single level
                    { expand: true, flatten: true, src: ['front-end/src/**/*.html', 'views/dialogs/*.html'], dest: 'public/html/', filter: 'isFile' }
                ]
            }
        },

        //watch
        watch: {
            options: {
                livereload: true,
            },
            css: {
                files: ["front-end/style/app.css", "views/*.ejs", "views/**/*.ejs"],
                tasks: ['concat:css']
            },
            js: {
                files: ['front-end/src/*.js',
                    'front-end/src/controllers/**/*.js',
                    'front-end/src/controllers/*.js',
                    'front-end/src/components/*.js',
                    'front-end/src/components/**/*.js',
                    'front-end/src/directives/**/*.js',
                    'front-end/src/directives/templates/*.html',
                    'front-end/src/services/**/*.js',
                    'front-end/src/filters/**/*.js',
                    'front-end/src/shared/*.js',
                    'front-end/src/shared/**/*.js',
                    'index.js'
                ],
                tasks: ['concat:dist']
            },
        },

        jshint: {
            files: {
                src: [
                    'front-end/src/*.js',
                    'front-end/src/controllers/*.js',
                    // 'front-end/src/directives/**/*.js',
                    // 'front-end/src/services/**/*.js',
                    // 'front-end/src/filters/**/*.js',
                    // 'front-end/src/components/**/*.js'
                ]
            },
            options: {
                jshintrc: '.jshintrc'
            }
        }
    });

    grunt.loadNpmTasks('grunt-contrib-copy');
    grunt.loadNpmTasks('grunt-contrib-uglify');
    grunt.loadNpmTasks('grunt-contrib-uglify-es');
    grunt.loadNpmTasks('grunt-contrib-concat');
    grunt.loadNpmTasks('grunt-contrib-jasmine');
    grunt.loadNpmTasks('grunt-jasmine-node-new');
    grunt.loadNpmTasks('grunt-contrib-watch');
    // grunt.loadNpmTasks('grunt-it'); //https://github.com/C2FO/grunt-it
    /**
     *
     *  "_strict": "use strict",
     *  "_browser": "document is not defined",
     *  "_devel": "console is not defined"
     * 
     */
    grunt.loadNpmTasks('grunt-contrib-jshint');


    /*grunt.registerTask('cleanup', 'cleans build tmp files', function(){
       	var gruntConfig = grunt.config();
       	grunt.file.delete(gruntConfig.concat.dist.dest);
       });*/

    grunt.registerTask('default', ['copy', 'concat', 'uglify' /*, 'cleanup'*/ ]);
    grunt.registerTask('debug', ['copy', 'concat']);
    grunt.registerTask('lint', ['jshint']);

    /**
     * this task will exec. by 'debug watcha' from the console will look for the changes you will made in any front-side files like 
     * controller, directive, services, ejs files, index.js, css etc. 
     * this includes all the functionality of the debug operation.
     */
    grunt.registerTask('watcha', ['copy', 'concat', 'concat:lib_debug', 'concat:dist', 'watch']);


};