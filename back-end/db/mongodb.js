var mongoose = require("mongoose");


var dbs = {};
var defaultConnection = null;
var defaultDatabase = "rugcopro-portals";


var useDb = function(database, errCallback, connectCallBack){
	if(database === undefined || database === null){
		throw "useDb expects a database name";
	}

	if(dbs !== null && dbs[database] !== null && dbs[database] !== undefined){
		if(connectCallBack) connectCallBack( dbs[database] );
		return dbs[database];
	}else{
		var defaultConnection = getDefaultConnection();
		var conn = defaultConnection.connection;
		var db = conn.useDb(database);
		dbs[database] = db;

		// db.on("error", function(){
		// 	console.error.bind(console, "connection error: ");
		// 	if(errCallback) errCallback();
		// });

		// db.once("open", function(){
		// 	console.log("Switched to "+database+" (MongoDB) successful");
		// 	if(connectCallBack) connectCallBack(db);
		// });


		return db;
	}
};

var getDefaultConnection = function(){
	return defaultConnection;
};

var setDefaultConnection = function(database){
	var db = useDb(database);
	defaultConnection = {
		connection:db,
		name:database
	};
};


var connect = function(database, errCallback, connectCallBack){
    // for local this is defined in .env (heroku local automatically creates an environment variable from this file)
    // for remote it is defined as an environment variable

    //------------------------------------------
	var databaseURI = process.env.MONGODB_OPS;
    //------------------------------------------
	


	if(database === undefined || database === null){
		database = defaultDatabase; // this database is the master database which contains the key to access al other databases
	}

	// for debugging, if not launching through heroku local (e.g. vistual studio code), we must define this manually
	//------------------------------------------
	if(databaseURI === undefined){
		databaseURI = "mongodb://localhost:27017/" + database;
		console.log("Defaulting to "+database+" on localhost:27017 for mongodb connection");
	}
	//------------------------------------------

	console.log("Attempting mongodb connection to " + databaseURI);
	var conn = mongoose.createConnection(databaseURI);
	
	// store a default connection object
	defaultConnection = {
		connection:conn,
		name:database
	};

	conn.on("error", function(err){
		console.log("Connection to MongoDB failed : " + err.message);
		if(errCallback) errCallback();
	});

	conn.on("open", function(){
		console.log("Connection to MongoDB successful");
		setDefaultConnection(database);
		if(connectCallBack) connectCallBack(conn);
	});

	return conn;

};



module.exports = {
	connect:connect,
	getDefaultConnection:getDefaultConnection,
	useDb:useDb
} 
