var express = require("express");
var router = express.Router();
var uuid = require('uuid');
var redis = require('../db/redis');
var schemaCache = require('../db/schema_cache');
var moment = require("moment");
var async = require("async");
var mongodb = require('../db/mongodb');
var schemaCache = require('../db/schema_cache');
var modelRouting = require("./model_routing");

var multipart = require('connect-multiparty');
var multipartMiddleware = multipart();
var sharp = require('sharp');
var AWS = require('aws-sdk');
var os = require('os');
var s3 = new AWS.S3({
    //signatureVersion: 'v4'
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});
var mime = require('mime-types');
var ejs = require('ejs');
var pdf = require('html-pdf');
var fs = require('fs');

var passport = require('passport');
//var Strategy = require('passport-http').BasicStrategy;
var auth = require("./auth/auth");
var Strategy = require('./auth/basic_authorization');

var _ = require('underscore');


var bodyParser = require('body-parser');
var jsonParser = bodyParser.json();


/*
 * Catch-all, all the requests for helpers will come through here first. We verify the auth_token here before continuing
 *
 */
router.use(function(req, res, next) {
    if (req.portal !== null) {
        // little trick to store authorization   in the header we want regardless of how it was passed
        if (req.headers.hasOwnProperty("x-authorization") && !req.headers.hasOwnProperty("authorization")) {
            req.headers.authorization = req.headers["x-authorization"];
        }

        // If there is an accountingGateway, map all the routes within THIS REQUEST to the active connector
        // *NOTE this gets overriden on every request if there is an accounting gateway and an active connector for the given portal
        if (_.isObject(accountingGateway) && _.isFunction(accountingGateway.getActiveConnector)) {
            accountingGateway.getActiveConnector(req, function(connector) {
                // if the connector exists and it is active...
                if (_.isObject(connector) && connector.isActive()) {
                    // store the connector in the request so we don't have to keep loading it
                    req.accounting_connector = connector;
                    // map all the connector urls to its actual connector urls
                    router.use('/accounting/connector/connector_urls', connector.getRouter());
                    //next(); // continue evaluating routes
                }
                // next(); // continue evaluating routes
            });
        }
        // no accounting gateway found, continue processing the request
        // else{
        //     router.use('/accounting/connector/connector_urls', function(req, res, next){
        //         res.json({error:"Invalid connector url"});
        //     });
        // }

        // // If there is an ecommerceGateway, map all the routes within THIS REQUEST to the active connector
        // // *NOTE this gets overriden on every request if there is an ecommerce gateway and an active connector for the given portal
        if (_.isObject(ecommerceGateway) && _.isFunction(ecommerceGateway.getActiveConnector)) {
            ecommerceGateway.getActiveConnector(req, function(connector) {
                // if the connector exists and it is active...
                if (_.isObject(connector) && connector.isActive()) {
                    // store the connector in the request so we don't have to keep loading it
                    req.ecommerce_connector = connector;
                    // map all the connector urls to its actual connector urls
                    router.use('/ecommerce/connector/connector_urls', connector.getRouter());
                    //next(); // continue evaluating routes
                }
                next(); // continue evaluating routes
            });
        }
    } else {
        res.json({ error: "Invalid portal" });
    }
});

//=================================================
// AUTHENTICATION methods
//=================================================

//verify authorization
var verifyAuth = function(req, res, callBack) {

    if (req.headers && req.headers.hasOwnProperty("x-auth-token")) {
        // get the redis client and try to get the corresponding object using the auth_token as a key
        var redisClient = redis.getClient();
        redisClient.get('auth_token.' + req.headers["x-auth-token"], function(err, reply) {
            if (err || !reply) {
                callBack({ error: "Unauthorized: Please sign in" });
                return;
            }

            // refresh the session expire to 20 mins

            redisClient.expire('auth_token.' + req.headers["x-auth-token"], 28800);
            req.user = JSON.parse(reply);
            callBack(null, true);

        });
    } else {
        callBack({ error: "Missing Authentication: Please sign in" });
        return;
    }
};

// logout route
router.route("/logout")
    .get(
        function(req, res) {
            var redisClient = redis.getClient();
            redisClient.del('auth_token.' + req.headers["x-auth-token"], function(err, reply) {
                if (!err || reply) {
                    res.statusMessage = "Thanks for using our services.";
                    res.status(401).end();
                    return;
                }
            });
        });

passport.use(
    new Strategy({
            passReqToCallback: true
        },
        function(req, username, password, cb) {
            console.log("Passport strategy received authorization for " + username);

            var UserModel = modelRouting.getModelByName(req.portal.db, "user");
            console.log("Valid UserSchema")
            if (UserModel) {
                console.log("Attempting to load user by username..");
                UserModel.findOne({ username: username }, function(err, user) {
                    if (err) {
                        console.log("An error occurred with UserModel.findOne");
                        console.error(err);
                        cb(err);
                        return;
                    }
                    if (!user) {
                        console.log("Unable to find user " + username);
                        cb(null, false);
                        return;
                    }
                    console.log("Found user " + user._id);
                    auth.verifyPassword(password, user.verify, function(err, res) {
                        if (err) {
                            console.log("An error occurred with auth.verifyPassword");
                            console.error(err);
                            cb(err);
                            return;
                        } else if (res === false) {
                            console.log("Password verification failed");
                            cb(null, false);
                            return;
                        } else {
                            console.log("Password matches");
                            cb(null, user);
                            return;
                        }
                    });
                });
            } else {
                cb(null, false);
                return;
            }
        }
    )
);


// Update a user's password
router.route("/user/:user_id/password")
    .put(jsonParser, function(req, res) {
        var UserSchema = modelRouting.getModelByName(req.portal.db, "user");
        if (UserSchema) {
            // verify existing password to make sure the user knows the current password in order to change it
            // -- auth.verifyPassword(password, user.verify, function(err, res){
            //});
            // verify that password and confirmation matc
            UserSchema.findById(req.params.user_id, function(err, user) {
                if (err) {
                    res.send(err);
                    return;
                }
                auth.verifyPassword(req.body.oldPassword, user.verify, function(err, result) {
                    if (err) {
                        res.send(err);
                        return;
                    }
                    if (result) {
                        if (req.body.newPassword == req.body.confirmPassword) {
                            auth.hashPassword(req.body.newPassword, function(err, passHash) {
                                if (err) {
                                    res.send(err);
                                    return;
                                }
                                var updateObj = {
                                    verify: passHash
                                };
                                UserSchema.update({ _id: user._id }, updateObj, null, function(err, raw) {
                                    if (err) {
                                        res.send(err);
                                        return;
                                    }
                                    console.log("inside redis > pass updated successfully for " + user._id);
                                    // res.json(raw);
                                    res.statusMessage = "Password updated successfully!";
                                    res.status(200).end();
                                    return;
                                });
                            });
                        } else {
                            console.log("inside redis > new and confirm password did not match");
                            // res.json(raw);
                            res.statusMessage = "new and confirm password did not match!!";
                            res.status(200).end();
                            return;
                        }
                    } else {
                        console.log("inside redis > auth.verifyPassword failed");
                        // res.json(raw);
                        res.statusMessage = "User Password did not match!!";
                        res.status(200).end();
                        return;

                    }


                });
            });
        }
    });

// logout route
router.route("/available_permissions")
    .get(
        function(req, res) {

            verifyAuth(req, res, function(err, authorized) {
                if (err) {
                    res.json(err);
                    return;
                }


                var auth = require("./auth/auth");
                // first load all the effective permissions so we can easily check if we can show them to the user
                auth.getEffectivePermissions(
                    req.portal.db,
                    req.user,

                    function(effectivePermissions) {

                        var availablePermissions = [];
                        var schemas = modelRouting.getModelSchemas();
                        var permPrefixes = {
                            "CREATE": "Create",
                            "READ": "Read",
                            "UPDATE": "Update",
                            "DELETE": "Delete"
                        };

                        for (var modelName in schemas) {
                            var modelInfo = schemas[modelName];
                            var permCategory = { name: modelName };

                            if (_.isString(modelName)) {
                                for (var prefixId in permPrefixes) {
                                    var prefixName = permPrefixes[prefixId];
                                    var perm = {
                                        "_id": prefixId + "_" + modelName.toUpperCase(),
                                        "name": prefixName + " " + modelName,
                                    };
                                    var perms = [perm, { "_id": prefixId + "_*" }];
                                    if (auth.hasOneOfPermissionSync(effectivePermissions, req.user, perms)) {
                                        if (!_.isArray(permCategory.permissions)) permCategory.permissions = [];
                                        permCategory.permissions.push(perm);
                                    }
                                }

                                if (_.isArray(permCategory.permissions)) {
                                    availablePermissions.push(permCategory);
                                }
                            }
                        }

                        res.json(availablePermissions);

                    });
            });


        }
    );

router.route("/staff/authenticate")
    .get(
        passport.authenticate('basic', { session: false }),
        function(req, res) {
            var StaffSchema = modelRouting.getModelByName(req.portal.db, "staff");
            console.log("Valid StaffSchema")
            if (StaffSchema) {
                StaffSchema.findOne({ user: req.user._id }, function(err, staff) {
                    if (err) {
                        console.log("An error occurred with StaffSchema.findOne");
                        console.error(err);
                        res.set('WWW-Authenticate', "Unable to find an staff in portal");
                        res.sendStatus(401);
                        return;
                    }
                    if (!staff) {
                        res.set('WWW-Authenticate', "Unable to find an staff in portal");
                        res.sendStatus(401);
                        console.log("Unable to find an staff in portal");
                        return;
                    }

                    var auth_token = uuid.v1();

                    var filteredStaff = {};
                    var jsonStaff = staff.toJSON();
                    for (var q in jsonStaff) {
                        if (q != "auth_token" && q != "verify") {
                            filteredStaff[q] = jsonStaff[q];
                        }
                    }
                    var filteredUser = {};
                    var jsonUser = req.user.toJSON();
                    for (var p in jsonUser) {
                        if (p != "auth_token" && p != "verify" && req.user) {
                            filteredUser[p] = jsonUser[p];
                        }
                    }

                    filteredStaff.user = filteredUser;

                    // Store the user in redis using the auth_token as the key
                    var redisClient = redis.getClient();
                    redisClient.set('auth_token.' + auth_token, JSON.stringify(filteredStaff));
                    redisClient.expire('auth_token.' + auth_token, 28800); // make the session expire in 20 mins


                    var filteredPortal = {};
                    for (var p in req.portal) {
                        if (p != "db" && req.portal) {
                            filteredPortal[p] = req.portal[p];
                        }
                    }
                    filteredStaff.portal = filteredPortal;

                    // load model-dependant references if required
                    if (_.isFunction(staff.loadReferences)) {

                        staff.loadReferences(req.portal.db, filteredStaff, function() {
                            var responseObj = {
                                _token: auth_token,
                                user: filteredStaff
                            };
                            res.json(responseObj);
                        });
                    } else {
                        var responseObj = {
                            _token: auth_token,
                            user: filteredStaff
                        };
                        res.json(responseObj);
                    }
                });
            }

        });

router.route("/customer/authenticate")
    .get(
        passport.authenticate('basic', { session: false }),
        function(req, res) {
            var CustomerSchema = modelRouting.getModelByName(req.portal.db, "customer");
            console.log("Valid CustomerSchema")
            if (CustomerSchema) {
                CustomerSchema.findOne({ user: req.user._id }, function(err, customer) {
                    if (err) {
                        console.log("An error occurred with CustomerSchema.findOne");
                        console.error(err);
                        res.set('WWW-Authenticate', "Unable to find an customer in portal");
                        res.sendStatus(401);
                        return;
                    }
                    if (!customer) {
                        console.log("Unable to find an customer in portal");
                        res.set('WWW-Authenticate', "Unable to find an customer in portal");
                        res.sendStatus(401);
                        return;
                    }

                    var auth_token = uuid.v1();

                    var filteredCustomer = {};
                    for (var q in customer) {
                        if (q != "auth_token" && q != "verify") {
                            filteredCustomer[q] = customer._doc[q];
                        }
                    }
                    var filteredUser = {};
                    for (var p in req.user._doc) {
                        if (p != "auth_token" && p != "verify" && req.user) {
                            filteredUser[p] = req.user._doc[p];
                        }
                    }

                    filteredCustomer.user = filteredUser;

                    // Store the user in redis using the auth_token as the key
                    var redisClient = redis.getClient();
                    redisClient.set('auth_token.' + auth_token, JSON.stringify(filteredCustomer));
                    redisClient.expire('auth_token.' + auth_token, 28800); // make the session expire in 20 mins

                    // load model-dependant references if required
                    if (_.isFunction(customer.loadReferences)) {

                        customer.loadReferences(req.portal.db, filteredCustomer, function() {
                            var responseObj = {
                                _token: auth_token,
                                user: filteredCustomer
                            };
                            res.json(responseObj);
                        });
                    } else {
                        var responseObj = {
                            _token: auth_token,
                            user: filteredCustomer
                        };
                        res.json(responseObj);
                    }
                });
            }

        });
//=================================================
// ACCOUNTING methods
//=================================================
function getKeyValue(dir, doc, filename) {
    if (dir) {
        //if dir is not null that means it is a development version
        return dir + "/" + filename;
    }
    return 'PDF' + (doc._dir || '/') + filename;
}
router.route("/pdf/:template")
    .put(jsonParser, function(req, res) { //create html buffer with the doc data and send it to the frontend for PREVIEW!.
        var doc = req.body;
        var html = fs.readFileSync('./views/' + req.params.template, 'utf8');
        var buf = ejs.render(html, doc);
        res.send({ html: buf });
    })
    .post(jsonParser, function(req, res) { //create pdf + upload to AWS + retrun the url.
        var doc = req.body;
        doc.printed = moment();
        var html = fs.readFileSync('./views/' + req.params.template, 'utf8');
        var zoomFactorValue = 1;

        if (os.platform() == 'linux' || os.platform() == 'darwin') {
            zoomFactorValue = 0.7;
            html = "<html xmlns='http://www.w3.org/1999/xhtml' style='zoom:" + zoomFactorValue + "'>" + html;
        } else {
            zoomFactorValue = 1;
            html = "<html xmlns='http://www.w3.org/1999/xhtml' style='zoom:" + zoomFactorValue + "'>" + html;
        }
        // var cfg = {};

        // var htmlContent = new QuillDeltaToHtmlConverter(doc.rug.appendix, cfg);
        // doc.rug.appendix = htmlContent;
        var buf = ejs.render(html, doc);
        var cur_date = getCurrentDateForPDF();
        var addressBar = formatAdddressForPDF(cur_date, doc);;

        var options = {
            format: "Letter", // allowed units: A3, A4, A5, Legal, Letter, Tabloid 
            orientation: "portrait", // portrait or landscape  
            header: {
                height: '30mm',
                contents: ''
            },
            footer: {
                height: '16mm',
                contents: '<div style="border-top:1px solid grey;margin: 0 auto;width:558px;"></div><div style="width:720px;margin:0 auto;padding-top:2mm;">' + addressBar + '</div>'
            }
        };

        if (doc.excludeOptions) {
            if (_.isArray(doc.excludeOptions)) {
                if (doc.excludeOptions.includes('header')) {
                    delete options.header;
                }
                if (doc.excludeOptions.includes('footer')) {
                    delete options.footer;
                }
            }
        }

        var dir;
        if (process.env.AWS_S3_BUCKET_SANDBOX_DIR) {
            dir = process.env.AWS_S3_BUCKET_SANDBOX_DIR;
        }
        pdf.create(buf, options).toBuffer(function(err, buffer) {
            var s3baseURL = process.env.AWS_S3_BASE_URL + req.portal.photo_bucket;
            var filename = (doc._preffix || '') + (doc._id || '') + new Date().getTime() + ".pdf";

            var params = {
                Bucket: req.portal.photo_bucket,
                Key: getKeyValue(dir, doc, filename),
                Body: buffer,
                ACL: 'public-read',
                ContentType: 'application/pdf'
            };
            s3.putObject(params, function(err, data) {
                if (err) throw err;
                res.json({ status: 'ok', url: s3baseURL + '/' + getKeyValue(dir, doc, filename) });
            });
        });


        /**
         * this part of the code is for debugging purposes.
         */
        /*
                let Duplex = require('stream').Duplex;

                function bufferToStream(buffer) {
                    let stream = new Duplex();
                    stream.push(buffer);
                    stream.push(null);
                    return stream;
                }


                pdf.create(buf, options)

                .toBuffer(function(err, buffer) {

                    var filename = (doc._preffix || '') + (doc._id || '') + new Date().getTime() + ".pdf";
                    var urlpdf = "E:/Job/rugcopro/" + filename;
                    bufferToStream(buffer).pipe(fs.createWriteStream('./' + filename));
                    res.json({ status: 'ok', url: urlpdf });
                });

                */

        //this is random commit.s
    });

function getCurrentDateForPDF(params) {
    return moment().format('L');
}

function formatAdddressForPDF(cur_date, doc) {
    var addressBar = "";
    if (doc.portal.company.address)
        addressBar += '<div style="padding-left:7.5mm;float:left;margin:0 auto;font-size:8px">' + cur_date + '</div><div align="center" style="float:left;font-size:8px;width:500px;margin:0 auto">' +
        '<p>' + doc.portal.company.address + ',&nbsp';
    if (doc.portal.company.city)
        addressBar += doc.portal.company.city + ',&nbsp';
    if (doc.portal.company.province)
        addressBar += doc.portal.company.province.name + ',&nbsp';
    if (doc.portal.company.postal)
        addressBar += doc.portal.company.postal + ',&nbsp</p>';
    if (doc.portal.company.fax)
        addressBar += '<span style="border-right: 1px solid grey;height:16px">fax. ' + doc.portal.company.fax + '&nbsp</span>';
    if (doc.portal.company.phone)
        addressBar += '<span style="border-right: 1px solid grey;height:16px">&nbsptel. ' + doc.portal.company.phone + '&nbsp</span>';
    if (doc.portal.company.website)
        addressBar += '<span style="border-right: 1px solid grey;height:16px">&nbsp' + doc.portal.company.website + '&nbsp</span>';
    if (doc.portal.company.email)
        addressBar += '<span style="height:16px">&nbsp' + doc.portal.company.email + '</span></div><div style="font-size:8px;float:left;margin:0 auto">pg.{{page}}/{{pages}}</div>';
    return addressBar;
}

router.route('/image/uploads')
    .post(multipartMiddleware, function(req, res) {
        var s3baseURL = process.env.AWS_S3_BASE_URL + req.portal.photo_bucket;
        //console.log(req.body, req.files);
        //console.log(req.files);
        if (!(Object.keys(req.files).length === 0 && req.files.constructor === Object)) { // false request.
            var images = [];
            var file = req.files.file;
            var src = file.path;
            var mimetype = mime.contentType(file.name);
            // console.log("file : " + JSON.stringify(file));
            fs.readFile(src, function(err, imgdata) {
                var params = {
                    Bucket: req.portal.photo_bucket,
                    Key: 'images/' + file.name,
                    Body: imgdata,
                    ACL: 'public-read',
                    ContentType: mimetype
                };
                s3.putObject(params, function(err, data) {
                    if (err) console.log(err);
                    ext = mimetype.substring(mimetype.lastIndexOf('/') + 1);

                    const image = sharp(imgdata)
                    image
                        .resize(80, 80)
                        .background({ r: 0, g: 0, b: 0, alpha: 0 })
                        .embed()
                        .toFormat(sharp.format.webp)
                        .toBuffer(function(err, outputBuffer) {
                            if (err) {
                                throw err;
                            }
                            var params = {
                                Bucket: req.portal.photo_bucket,
                                Key: 'thumbnails/' + file.name,
                                Body: outputBuffer,
                                ACL: 'public-read',
                                ContentType: mimetype
                            };
                            s3.putObject(params, function(err, data) {
                                if (err) res.status(500).send("s3 upload failed.");
                                images.push({
                                    url: s3baseURL + '/images/' + file.name,
                                    thumbnail: s3baseURL + '/thumbnails/' + file.name
                                });
                                fs.unlink(src); // delete uploaded file on webserver.
                                res.json({ status: 'ok', error: '', images: images });
                            });
                            // outputBuffer contains WebP image data of a 200 pixels wide and 300 pixels high
                            // containing a scaled version, embedded on a transparent canvas, of input.gif
                        });

                    // lwip.open(imgdata, ext, function(err, image) {
                    //     var size = image.width() > image.height() ? image.width() : image.height();
                    //     // console.log(JSON.stringify(image));console.log(size);
                    //     image.contain(size, size, function(err, image) {
                    //         image.resize(80, 80, function(err, image) {
                    //             image.toBuffer(ext, function(err, buffer) {
                    //                 var params = {
                    //                     Bucket: req.portal.photo_bucket,
                    //                     Key: 'thumbnails/' + file.name,
                    //                     Body: buffer,
                    //                     ACL: 'public-read',
                    //                     ContentType: mimetype
                    //                 };
                    //                 s3.putObject(params, function(err, data) {
                    //                     if (err) res.status(500).send("s3 upload failed.");
                    //                     images.push({
                    //                         url: s3baseURL + '/images/' + file.name,
                    //                         thumbnail: s3baseURL + '/thumbnails/' + file.name
                    //                     });
                    //                     fs.unlink(src); // delete uploaded file on webserver.
                    //                     res.json({ status: 'ok', error: '', images: images });
                    //                 });
                    //             });
                    //         });
                    //     });
                    // })
                })

            });
            // async.each(req.files.file, function(file, callback) {
            //     var src = file.path;
            //     var mimetype = mime.contentType(file.name);

            //     fs.readFile(src, function(err, imgdata) {
            //         var params = {
            //             Bucket: req.portal.photo_bucket,
            //             Key: 'images/' + file.name,
            //             Body: imgdata,
            //             ACL: 'public-read',
            //             ContentType: mimetype
            //         };
            //         s3.putObject(params, function(err, data) {
            //             if (err) console.log(err);
            //             ext = mimetype.substring(mimetype.lastIndexOf('/') + 1);
            //             lwip.open(imgdata, ext, function(err, image) {
            //                 image.crop(80, 80, function(err, image) {
            //                     image.toBuffer(ext, function(err, buffer) {
            //                         var params = {
            //                             Bucket: req.portal.photo_bucket,
            //                             Key: 'thumbnails/' + file.name,
            //                             Body: buffer,
            //                             ACL: 'public-read',
            //                             ContentType: mimetype
            //                         };
            //                         s3.putObject(params, function(err, data) {
            //                             if (err) throw err;
            //                             images.push({
            //                                 url: s3baseURL + '/images/' + file.name,
            //                                 thumbnail: s3baseURL + '/thumbnails/' + file.name
            //                             });
            //                             fs.unlink(src, callback()); // delete uploaded file on webserver.
            //                         });
            //                     });
            //                 });
            //             })
            //         })

            //     });
            // }, function(err) { // done.
            //     if (err) res.status(500).send("s3 upload failed.");
            //     //console.log(images);
            //     res.json({ status: 'ok', error: '', images: images });
            // });
        }
    });

//=================================================
// PORTAL methods
//=================================================

// Authorize the accounting connector
router.route("/portal/:portal_id")
    .put(jsonParser, function(req, res) {
        verifyAuth(req, res, function(err, authorized) {
            if (err) {
                res.json(err);
                return;
            };

            var defaultConnection = mongodb.getDefaultConnection();
            var PortalModel = modelRouting.getModelByName(defaultConnection, "portal");
            if (PortalModel) {
                PortalModel.findById(req.params.portal_id, function(err, model) {
                    if (err) {
                        res.send(err);
                        return;
                    }
                    var filledModel = {};
                    var pendingCallBacks = [];
                    if (model._doc) {
                        var updateObj = {};
                        for (var prop in req.body) {
                            updateObj[prop] = req.body[prop];
                        }
                        PortalModel.findByIdAndUpdate({ _id: req.params.portal_id }, updateObj, { runValidators: true }, function(err, raw) {
                            if (err) {
                                res.json({ error: err.message });
                                return;
                            }


                            PortalModel.findById(req.params.portal_id, function(err, updatedPortal) {
                                schemaCache.updateKeyValue(defaultConnection, "portal", "url", "portals", updatedPortal, function() {
                                    // this raw seems to be the loaded doc before updating it!
                                    // we're passing raw here because in the eent of a validator error, it will contain the error
                                    res.json(updatedPortal);
                                });
                            });



                        });

                    }
                });
            }

        });
    });

// embedded list add to list method
// Working with sets
router.route("/portal/:portal_id/add_to_set")
    .put(jsonParser, function(req, res) {
        var defaultConnection = mongodb.getDefaultConnection();
        var Model = modelRouting.getModelByName(defaultConnection, "portal");
        if (Model) {
            Model.findById(req.params.portal_id, function(err, model) {
                if (err) {
                    res.send(err);
                    return;
                }
                var filledModel = {};
                var pendingCallBacks = [];
                if (model._doc) {
                    var addToSet = {
                        "$addToSet": {}
                    };
                    var updateObj = addToSet.$addToSet;
                    for (var prop in req.body) {
                        updateObj[prop] = req.body[prop];
                    }
                    Model.findByIdAndUpdate({ _id: req.params.portal_id }, addToSet, { runValidators: true }, function(err, raw) {
                        if (err) {
                            res.send(err);
                            return;
                        }
                        // this raw seems to be the loaded doc before updating it!
                        // we're passing raw here because in the eent of a validator error, it will contain the error
                        Model.findById(req.params.portal_id, function(err, updatedPortal) {
                            schemaCache.updateKeyValue(defaultConnection, "portal", "url", "portals", updatedPortal, function() {
                                // this raw seems to be the loaded doc before updating it!
                                // we're passing raw here because in the eent of a validator error, it will contain the error
                                res.json(updatedPortal);

                            });
                        });
                    });
                }
            });
        }
    });

router.route("/portal/:portal_id/remove_from_set")
    .put(jsonParser, function(req, res) {
        var defaultConnection = mongodb.getDefaultConnection();
        var Model = modelRouting.getModelByName(defaultConnection, "portal");
        if (Model) {
            Model.findById(req.params.portal_id, function(err, model) {
                if (err) {
                    res.send(err);
                    return;
                }
                var filledModel = {};
                var pendingCallBacks = [];
                if (model._doc) {
                    var removeFromSet = {
                        "$pull": {}
                    };
                    var updateObj = removeFromSet.$pull;
                    for (var prop in req.body) {
                        updateObj[prop] = req.body[prop];
                    }
                    Model.findByIdAndUpdate({ _id: req.params.portal_id }, removeFromSet, { runValidators: true }, function(err, raw) {
                        if (err) {
                            res.send(err);
                        }
                        // this raw seems to be the loaded doc before updating it!
                        // we're passing raw here because in the eent of a validator error, it will contain the error
                        Model.findById(req.params.portal_id, function(err, updatedPortal) {
                            schemaCache.updateKeyValue(defaultConnection, "portal", "url", "portals", updatedPortal, function() {
                                // this raw seems to be the loaded doc before updating it!
                                // we're passing raw here because in the eent of a validator error, it will contain the error
                                res.json(updatedPortal);
                            });
                        });
                    });
                }
            });
        }
    });


//=================================================
// ACCOUNTING methods
//=================================================

// Authorize the accounting connector
router.route("/accounting/connector/authorize")
    .get(jsonParser, function(req, res) {
        // First check if there is an accounting gateway and we can get an active connector
        if (_.isObject(req.accounting_connector)) {
            // if the connector exists and it is active..
            if (_.isObject(req.accounting_connector) && req.accounting_connector.isActive()) {
                // invoke its authorize method, each connector is responsible for authorizing us to its respective software in the correct way for that platform
                // we pass in the req and res objects so that it may do whatever it considers necessary
                console.log("going to authorize connector");
                req.accounting_connector.authorize(req, res, function(err, resp) {
                    if (err) {
                        res.json(err);
                    } else {
                        res.json(resp);
                        return;
                    }
                });
            } else {
                res.json({ message: "Unable to authorize connector" });
            }
        }
    });

// Activate an accounting connector
router.route("/accounting/connector/:connector_id/activate")
    .get(jsonParser, function(req, res) {
        // First check if there is an accounting gateway and we can get an active connector
        if (_.isObject(accountingGateway) && _.isFunction(accountingGateway.activate)) {
            // this will de-activate all other connectors
            accountingGateway.activate(req, req.params.connector_id, function(err, raw) {
                if (err) {
                    res.json({ message: "Unable to activate connector" });
                    return;
                }
                res.json({ success: true });
            });
        } else {
            res.json({ message: "There is no accounting gateway" });
        }
    });

// Activate an accounting connector
router.route("/accounting/connector/:connector_id/deactivate")
    .get(jsonParser, function(req, res) {
        // First check if there is an accounting gateway and we can get an active connector
        if (_.isObject(accountingGateway) && _.isFunction(accountingGateway.deactivate)) {
            // this will de-activate all other connectors
            accountingGateway.deactivate(req, req.params.connector_id, function(err, raw) {
                if (err) {
                    res.json({ message: "Unable to deactivate connector" });
                    return;
                }
                res.json({ success: true });
            });
        } else {
            res.json({ message: "There is no accounting gateway" });
        }
    });




//=================================================
// eCommerce methods
// //=================================================

// Authorize the accounting connector
router.route("/ecommerce/connector/authorize/:authKey")
    .get(jsonParser, function(req, res) {
        // First check if there is an ecommerce gateway and we can get an active connector
        if (_.isObject(req.ecommerce_connector)) {
            // if the connector exists and it is active..
            if (_.isObject(req.ecommerce_connector) && req.ecommerce_connector.isActive()) {
                // invoke its authorize method, each connector is responsible for authorizing us to its respective software in the correct way for that platform
                // we pass in the req and res objects so that it may do whatever it considers necessary
                console.log("going to authorize connector");
                console.log(Buffer.from(req.params.authKey, 'base64').toString());

                var authKeyValue = Buffer.from(req.params.authKey, 'base64').toString();
                console.log(authKeyValue);
                req.ecommerce_connector.authorize(req, res, req.params.authKey, function(err, raw) {
                    if (err) {
                        res.json({ message: err + "Unable to authorize connector" });
                        return;
                    }
                    res.json({ success: true });
                });
            } else {
                res.json({ message: "Unable to authorize connector" });
            }
        }
    });

// // Activate an ecommerce connector
router.route("/ecommerce/connector/:connector_id/activate")
    .get(jsonParser, function(req, res) {
        // First check if there is an ecommerce gateway and we can get an active connector
        if (_.isObject(ecommerceGateway) && _.isFunction(ecommerceGateway.activate)) {
            // this will de-activate all other connectors
            ecommerceGateway.activate(req, req.params.connector_id, function(err, raw) {
                if (err) {
                    res.json({ message: err + "Unable to activate connector" });
                    return;
                }
                res.json({ success: true });
            });
        } else {
            res.json({ message: "There is no ecommerce gateway" });
        }
    });

// // Activate an ecommerce connector
router.route("/ecommerce/connector/:connector_id/deactivate")
    .get(jsonParser, function(req, res) {
        // First check if there is an ecommerce gateway and we can get an active connector
        if (_.isObject(ecommerceGateway) && _.isFunction(ecommerceGateway.deactivate)) {
            // this will de-activate all other connectors
            ecommerceGateway.deactivate(req, req.params.connector_id, function(err, raw) {
                if (err) {
                    res.json({ message: err + "Unable to deactivate connector" });
                    return;
                }
                res.json({ success: true });
            });
        } else {
            res.json({ message: "There is no ecommerce gateway" });
        }
    });



//=================================================
// TIMESHEET methods
//=================================================

router.route("/clock_in")
    .get(
        function(req, res) {
            verifyAuth(req, res, function(err, authorized) {
                if (err) {
                    res.json(err);
                    return;
                };

                var TimeLogSchema = modelRouting.getModelByName(req.portal.db, "time_log");

                if (TimeLogSchema) {
                    TimeLogSchema.findOne({
                        "staff._id": req.user._id,
                        start_stamp: { $ne: null },
                        end_stamp: null
                    }, function(err, timeLog) {
                        // if timeLog is defined, it means there is already a clock in without a clock out
                        if (timeLog) {
                            res.json({ error: "Timer already started, unable to clock in twice" });
                            return;
                        }

                        var newTimeLog = new TimeLogSchema();
                        newTimeLog.start_stamp = moment.utc().format("X"); // get the utc time and spit it out in a unix timestamp in seconds
                        newTimeLog.staff = {
                            _id: req.user._id,
                            name: req.user.name
                        }; // Auto set the user for the timelog
                        newTimeLog.save(function(err) {
                            if (err) {
                                res.send(err);
                                return;
                            }

                            res.json({ success: true });
                        });

                    });
                }
            });

        });


router.route("/clock_out")
    .get(
        function(req, res) {
            verifyAuth(req, res, function(err, authorized) {
                if (err) {
                    res.json(err);
                    return;
                };

                var TimeLogSchema = modelRouting.getModelByName(req.portal.db, "time_log");

                if (TimeLogSchema) {
                    TimeLogSchema.findOne({
                        "staff._id": req.user._id,
                        start_stamp: { $ne: null },
                        end_stamp: null
                    }, function(err, timeLog) {
                        // if timeLog is defined, it means there is already a clock in without a clock out
                        if (!timeLog) {
                            res.json({ error: "No timer running, unable to clock out" });
                            return;
                        }

                        var updateObj = {
                            end_stamp: moment.utc().format("X") // get the utc time and spit it out in a unix timestamp in seconds
                        };

                        TimeLogSchema.update({ _id: timeLog._id }, updateObj, null, function(err, raw) {
                            if (err) {
                                res.send(err);
                                return;
                            }

                            res.json({ success: true });
                        });

                    });
                }
            });

        });


//=================================================
// COMMISSIONS methods
//=================================================

router.route("/calculate_commissions")
    .get(
        function(req, res) {
            verifyAuth(req, res, function(err, authorized) {
                if (err) {
                    res.json(err);
                    return;
                };

                var ServiceEntrySchema = modelRouting.getModelByName(req.portal.db, "service_entry");
                var CommissionRunSchema = modelRouting.getModelByName(req.portal.db, "commission_run");
                var CommissionSchemeSchema = modelRouting.getModelByName(req.portal.db, "commission_scheme");

                // function to calculate a commission amount                
                var calculateCommissionAmount = function(serviceEntry, commissionSchemes, commission_job) {
                    if (
                        commission_job &&
                        commission_job._id &&
                        commissionSchemes &&
                        commissionSchemes.length > 0 &&
                        serviceEntry &&
                        serviceEntry.service &&
                        serviceEntry.amount > 0
                    ) {
                        for (var s = 0; s < commissionSchemes.length; s++) {
                            var commScheme = commissionSchemes[s];
                            if (
                                commScheme &&
                                commScheme.commission_job &&
                                commScheme.commission_job._id.equals(commission_job._id) &&
                                commScheme.service &&
                                commScheme.service._id.equals(serviceEntry.service._id)
                            ) {

                                return serviceEntry.amount * (commScheme.commission_percent / 100);
                            }
                        }
                    }

                    return 0;
                };

                // Data methods
                if (ServiceEntrySchema && CommissionSchemeSchema) {

                    CommissionSchemeSchema.find({}, function(err, commissionSchemes) {
                        // if there are no commission scheme entries, throw an error
                        if (!commissionSchemes || commissionSchemes.length == 0) {
                            res.json({ error: "Unable to calculate commissions, please define commission schemes" });
                            return;
                        }

                        ServiceEntrySchema.find({
                            commission_run: null
                        }, function(err, serviceEntries) {
                            // if there are no service entries, there is nothing to do for us
                            if (!serviceEntries || serviceEntries.length == 0) {
                                res.json({ error: "There are no pending service entries" });
                                return;
                            }

                            // create a new commission run
                            var commRun = new CommissionRunSchema();
                            commRun.created_by = {
                                _id: req.user._id,
                                name: req.user.name
                            }; // Auto set the created_by to the user executing this request

                            commRun.save(function(err) {
                                if (err) {
                                    res.send(err);
                                    return;
                                }

                                var CommissionItemSchema = modelRouting.getModelByName(req.portal.db, "commission_item");
                                if (CommissionItemSchema) {
                                    for (var i = 0; i < serviceEntries.length; i++) {
                                        var servEntry = serviceEntries[i];

                                        // save the commission for the primary staff
                                        var commItem = new CommissionItemSchema();
                                        commItem.commission_run = commRun._id;
                                        commItem.service_entry = servEntry;
                                        commItem.service = servEntry.service;
                                        commItem.staff = servEntry.primary_staff;
                                        commItem.commission_job = servEntry.commission_job;
                                        commItem.amount = calculateCommissionAmount(servEntry, commissionSchemes, servEntry.commission_job);
                                        commItem.save(function(err) {
                                            if (err) {
                                                res.send(err);
                                                return;
                                            }
                                        });

                                        // save the commission for the secondary staff
                                        if (servEntry.secondary_staff) {
                                            var commItem = new CommissionItemSchema();
                                            commItem.commission_run = commRun._id;
                                            commItem.service_entry = servEntry;
                                            commItem.service = servEntry.service;
                                            commItem.staff = servEntry.secondary_staff;
                                            commItem.commission_job = servEntry.secondary_commission_job;
                                            commItem.amount = calculateCommissionAmount(servEntry, commissionSchemes, servEntry.secondary_commission_job);
                                            commItem.save(function(err) {
                                                if (err) {
                                                    res.send(err);
                                                    return;
                                                }
                                            });
                                        }

                                        // update the service entry with the commission run id                                        
                                        var updateObj = { commission_run: commRun._id };
                                        ServiceEntrySchema.update({ _id: servEntry._id }, updateObj, null, function(err, raw) {
                                            if (err) {
                                                res.send(err);
                                                return;
                                            }
                                        });

                                    }

                                    // all done
                                    res.json({ success: true });
                                }

                            });

                        });

                    });
                }
            });

        });


//=================================================
// PAYROLL methods
//=================================================

router.route("/calculate_payroll")
    .get(
        function(req, res) {
            verifyAuth(req, res, function(err, authorized) {
                if (err) {
                    res.json(err);
                    return;
                };




            });
        })


module.exports = {
    router: router
};