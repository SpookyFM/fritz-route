#!/usr/bin/env node

const axios = require("axios");
const https = require("https");
const util = require("util");
const crypto = require('crypto');
var querystring = require('querystring');
const cheerio = require('cheerio')
var ipaddr = require('ipaddr.js');
var parseString = require('xml2js').parseString;
const {promisify} = require('util');
const Confabulous = require('confabulous');
const url = require('url');
const loaders = Confabulous.loaders;

// Global configuration, set by ReadArgumentsAndConfig
var config = null;

// Allow self-signed certificate by FritzBox
const instance = axios.create({
	httpsAgent: new https.Agent({  
		rejectUnauthorized: false
	})
});

// Helper function for constructing the request object of a Route
function SetIPAddressOnObject(object, name, address)
{
	var array = address.toByteArray();
	for (var i = 0; i < 4; i++)
	{
		var currentName = name + i;
		object[currentName] = array[i];
	}
}

class Route {
	
	constructor(index, network, subnetMask, gateway, isActive)
	{
		this._index = index;
		this._network = ipaddr.parse(network);
		this._subnetMask = ipaddr.parse(subnetMask);
		this._gateway = ipaddr.parse(gateway);
		this._isActive = isActive;
	}

	hasSameParameters(other)
	{
		var result = 
			this._network.match(other._network, 32) &&
			this._subnetMask.match(other._subnetMask, 32) &&
			this._gateway.match(other._gateway, 32);
		return result;
	}
	
	getRequestObject()
	{
		var result = {};
		SetIPAddressOnObject(result, 'ip', this._network);
		SetIPAddressOnObject(result, 'mask', this._subnetMask);
		SetIPAddressOnObject(result, 'gw', this._gateway);
		if (this._isActive)
		{
			result.route_activ = 'on';
		}
		// Required, needs to have a correct number (starts at 0)
		result.route = `route${this._index}`;
		result.oldpage = '/net/new_static_route.lua';
		result.apply = '';
		// TODO: Required?
		result.myXhr = 1;
		result.xhr = 1;
		result.useajax = 1;
		result.lang = 'de';
		result.no_sidrenew = '';
		
		return result;
	}

	toString()
	{
		var result = `Route${this._index} Network: ${this._network}, Subnetmask: ${this._subnetMask}, Gateway: ${this._gateway}, Active: ${this._isActive}`;
		return result;
	}
}

// Reads the command line args and a configuration json file (optional)
async function ReadArgumentsAndConfig(configFile)
{
	var confab = new Confabulous();
	confab.add(config => { return loaders.args() });
	if (configFile != undefined)
	{
		confab.add(config => { return loaders.require({ path: configFile }) });
	}
	var confab_end = promisify(confab.end);
	return confab_end()
	.then((data => 
	{
		if (configFile === undefined && data['config-file'] != undefined)
		{
			return ReadArgumentsAndConfig(data['config-file']);
		}
		config = data;
		// Set the default value for the active flag in case it is not specified
		if (config.active === undefined && config.toggle === undefined)
		{
			config.active = true;
		}
		return ValidateConfig();
	}));
}

// If value is undefined, print the message and return false
function ValidateValue(value, message)
{
	if (value === undefined)
	{
		console.log(message);
		return false;
	}
	return true;
}

// Validate all values in the config and return the result
function ValidateConfig()
{
	var result = true;
	result &= ValidateValue(config.user, 'Please specify a valid user!');
	result &= ValidateValue(config.password, 'Please specify a valid password!');
	result &= ValidateValue(config.url, 'Please specify a valid URL for the FritzBox!');
	result &= ValidateValue(config.network, 'Please specify a valid network address!');
	result &= ValidateValue(config.subnet, 'Please specify a valid subnet mask!');
	result &= ValidateValue(config.gateway, 'Please specify a valid gateway IP address!');
	return result;
}


function GetChallengeResponse(challenge, password) {
	// TODO: Should adjust unicode
	var challengeSource = challenge + "-" + password;
	var challengeSourceBytes = Buffer.from(challengeSource, 'utf16le')
	var hash = crypto.createHash('md5').update(challengeSourceBytes).digest("hex");
	return challenge + "-" + hash;
} 


async function Login()
{
	const loginURL = new URL('/login_sid.lua', config.url);
	const firstResponse = await instance({method: 'get', url: url.format(loginURL), responseType:'document'});
	
	var result = await util.promisify(parseString)(firstResponse.data);
	
	var SID = result.SessionInfo.SID[0];
	var challenge = result.SessionInfo.Challenge[0];
	// console.log(SID)
	// console.log(challenge);
	
	var newURL = new URL(`login_sid.lua?username=${config.user}&response=${GetChallengeResponse(challenge, config.password)}`, config.url);
	const secondResponse = await instance({method: 'get', url: url.format(newURL), responseType:'document'});
	result = await util.promisify(parseString)(secondResponse.data);
	return result.SessionInfo.SID[0];
}

// Returns an array of Route objects (no Set in order to keep the ordering consistent with the table)
async function QueryRoutes()
{
	// TODO: page: 'overview' generates json, but this does not seem to work everywhere
	var query = querystring.stringify({ sid: SID, page: 'static_route_table', xhr: '1' });
	
	var queryURL = new URL('/data.lua', config.url);
	const response = await instance({method: 'post', url: url.format(queryURL), responseType:'document', data: query});
	
	const $ = cheerio.load(response.data);
	var table = $('#uiViewRouteTable');
	var tr = table.find('tr:not(".thead")');
	
	var parsedRoutes = [];
	var rows = [];
	var isEmpty = false;
	
	tr.map((rowIndex, currentTR) => {
		rows.push(currentTR);
	});

	if (rows.length == 1)
	{
		// Check if this indicates that there are none
		isEmpty = $(rows[0]).children().eq(0).hasClass('txt_center');
	}

	if (!isEmpty)
	{
		for (var rowIndex = 0; rowIndex < rows.length; rowIndex++)
		{
			var currentTR = rows[rowIndex];
			var isActive = $(currentTR).children().eq(0).children().first().prop('checked');
			var network = $(currentTR).children().eq(1).text();
			var subnetMask = $(currentTR).children().eq(2).text();
			var gateway = $(currentTR).children().eq(3).text();
			var currentRoute = new Route(rowIndex, network, subnetMask, gateway, isActive);
			parsedRoutes.push(currentRoute);
		}
	}
	
	return parsedRoutes;
}

// Set whether an already existing route is active or not
async function SetRouteActive(route, newIsActive)
{
	// It's easier and less web-scraping if we just re-use the old route
	route._isActive = newIsActive;
	await CreateRoute(route);
}

// Create a new route
async function CreateRoute(route)
{
	var queryObject = route.getRequestObject();
	queryObject.sid = SID;
	query = querystring.stringify(queryObject);

	var queryURL = new URL('/data.lua', config.url);
	const response = await instance({method: 'post', url: url.format(queryURL), responseType:'document', data: query});
}

async function PrintRoutes()
{
	var routes = await QueryRoutes();

	for (var currentRoute of routes)
	{
		console.log(currentRoute.toString());
	}
}

async function main()
{

	var configValid = await ReadArgumentsAndConfig();
	if (!configValid)
	{
		return;
	}
   
	SID = await Login();

	var existingRoutes = await QueryRoutes();
	var configRoute = new Route(undefined, config.network, config.subnet, config.gateway);

	var route = existingRoutes.find(function(currentRoute) {
		var matches = configRoute.hasSameParameters(currentRoute);			
		return matches;
	});

	if (route === undefined)
	{
		route = new Route(existingRoutes.length, config.network, config.subnet, config.gateway, config.active);
	}
	
	var newActive = config.active;
	if (config.toggle)
	{
		newActive = !route._isActive;
	}

	await SetRouteActive(route, newActive);
}

main();