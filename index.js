var express = require('express');
var mongodb = require('./back-end/db/mongodb');
var redis = require('./back-end/db/redis');
var schemaCache = require('./back-end/db/schema_cache');
var autoIncrement = require('mongoose-auto-increment');
var modelRouting = require("./back-end/api/model_routing");
var multiparty = require('multiparty');
var _ = require('underscore');

var app = express();
app.set("ready", false);


var api = require("./back-end/api");

app.set('port', (process.env.PORT || 5000));
app.use(express.static(__dirname + '/public'));

// views is directory for all template files
app.set('views', __dirname + '/views');
// app.set('viewsa', __dirname + '/views/order-system');
app.set('view engine', 'ejs');

// if someone tries to load the root of the site, send them to the landing page
app.get('/', function(req, res) {
    res.render('index');
});

/* 
    this set the favicon.ico request status 204
    by setting 204 it means that the server receives the request but there is nothing to send it back to client
    
*/
app.get('/favicon.ico', function(req, res) {
    res.sendStatus(204)
});



app.use('/home/*', function(req, res) {
    res.render(req.originalUrl);
});


app.listen(app.get('port'), function() {
    console.log('Node app is running on port', app.get('port'));
});

app.get('/:portal_url/barcode/:type/:scale/:height/:text', function(req, res) {
    //e.g. http://localhost:5000/turcopersian/barcode/code39/3/10/12345789
    barcode.genImage(req, res);
});