var Promise = require('promise');
var cookies = require('cookie');
var util = require('util');
var Client = new require('node-rest-client').Client;

InvalidAuthenticationException = function(msg){
	this.message = msg;
	this.name = "InvalidAuthenticationException";
};

FailedRequestException = function(msg, statusCode, response, url){
	this.message = msg;
	this.response = response;
	this.statusCode = statusCode;
	this.url = url;
	this.name = "FailedRequestException";
};

var qcApi = function(){
	this.isAuthenticated = false;
};

qcApi.prototype.getClient = function(args){
	return new Client(args);
};

qcApi.prototype.trimSlash = function(url){

	if(url)
	{
		if(typeof(url) != 'string')
			throw 'Url is not string: ' + url;

		if(url.length > 0 && url[url.length - 1] == '/')
			url = url.substr(0, url.length - 1);
		if(url.length > 0 && url[0] == '/')
			url = url.substr(1, url.length);
	}

	return url;
};

qcApi.prototype.prependSlash = function(url){
	return url[0] == '/' ? url : "/" + url;
}

qcApi.prototype.startSession = function(){

	var promise = new Promise(function(resolve, reject){

		this.client.post(this.rootUrl + "/rest/site-session", { headers: { cookie : this.authCookie } }, function(data, res){

			if(res.statusCode != 201)
			{
				reject("Session start failed, status code " + res.statusCode);
				return;
			}

			this.authCookie += ";" + res.headers['set-cookie'].join(';');

			resolve();

		}.bind(this));

	}.bind(this));

	return promise;
}

qcApi.prototype.login = function(connInfo){

	var promise = new Promise(function(resolve, reject){

		this.rootUrl = this.trimSlash(connInfo.server);
		this.connInfo = connInfo;
		this.client = this.getClient({user: connInfo.user, password: connInfo.password});
		this.domain = connInfo.domain;
		this.project = connInfo.project;

		this.client.get(this.rootUrl + "/authentication-point/authenticate", function handleAuthResponse(data, res){

			if(res.statusCode == 200)
			{
				this.isAuthenticated = true;
				this.authCookie = res.headers['set-cookie'].join(';');
				this.startSession().then(resolve, reject);
			}
			else if(res.statusCode == 401)
			{
				this.isAuthenticated = false;
				reject(new InvalidAuthenticationException(util.format("Failed to authenticate '%s' against %s, please verify username and password are correct", connInfo.user, this.rootUrl)));
			}
			else
			{

				this.isAuthenticated = false;
				var error = new InvalidAuthenticationException(util.format("Failed to authenticate '%s' against %s: status code %s", connInfo.user, this.rootUrl, res.statusCode));
				error.response = data.toString('utf8');
				reject(error);
			}

		}.bind(this));

	}.bind(this));

	return promise;

};

qcApi.prototype.verifyAuthenticated = function(){
	if(!this.isAuthenticated)
		throw new InvalidAuthenticationException("Not yet logged in, please call login to authenticate.");
}

/**
* If the REST call response is an entity, some processing is performed on the resulting javascript object, such as putting each field as a property
* on the object instead of an object in the entities property list
* @param {obj} Should be a javascript object returned from the node-rest-client, parsed from a REST call xml or json response
*/
qcApi.prototype.convertResult = function(obj){

	if(obj.Entities == undefined)
		return obj;

	var result = [];
	result.totalResults = parseInt(obj.Entities['$'].TotalResults);

	if(result.totalResults == 0)
		return result;

	obj.Entities.Entity.forEach(function(entity){

		var convertedEntity = {
			type: entity['$'].Type
		};

		entity.Fields[0].Field.forEach(function(field){
			var name = field['$'].Name;
			var value = field.Value ? field.Value[0] : null;
			convertedEntity[name] = value;
		});

		result.push(convertedEntity);
  	});

	return result;
};

qcApi.prototype.buildUrl = function(url, options){

	targetUrl = this.rootUrl + "/rest";
	if(this.domain)
	{
		targetUrl += "/domains/" + this.domain;
		if(this.project)
			targetUrl += "/projects/" + this.project;
	}

	targetUrl += this.prependSlash(url);

	if(options)
	{
		if(typeof(options) != 'object')
			throw 'Expected parameter options to be an object but got ' + typeof(options);

		var queryString = [];
		if(options.pageSize)
			queryString.push('page-size=' + options.pageSize);

		if(options.fields && options.fields.length != undefined)
			queryString.push('fields=' + options.fields.join(','));

		if(queryString.length > 0)
		{
			var appendCharacter = url.indexOf('?') >= 0 ? '&' : '?';
			targetUrl = targetUrl + appendCharacter + queryString.join('&');
		}
	}

	return targetUrl;

};

qcApi.prototype.get = function(url, options) {

	var promise = new Promise(function(resolve, reject){

		this.verifyAuthenticated();

		url = this.buildUrl(url, options);

		this.client.get(url, { headers: { cookie: this.authCookie } }, function handleGetResponse(data, res){

			if(res.statusCode != 200)
				reject(new FailedRequestException("Failed to process url", res.statusCode, data.toString('utf8'), url));
			else
				resolve(this.convertResult(data));

		}.bind(this));

	}.bind(this));

	return promise;
};



module.exports = {
	create: function(){
		return new qcApi();
	}
};
