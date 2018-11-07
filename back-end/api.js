var express = require("express");
var router = express.Router();
var modelRouting = require("./api/model_routing");
var helperRouting = require("./api/helper_routing");


router.get('/', function(req, res) {
    res.json({ message: 'This is the root of the API, nothing to see here' });
});

module.exports = {
    router: helperRouting.router,
    modelRouter: modelRouting.router
};