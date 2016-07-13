/*
 * Publish S3 logs produced by CloudTrail to an AWS Elastic Search domain
 *
 * Initial code based on a mix of:
 * https://github.com/awslabs/amazon-elasticsearch-lambda-samples/blob/master/src/s3_lambda_es.js
 * and
 * http://docs.aws.amazon.com/lambda/latest/dg/wt-cloudtrail-create-function-create-function.html
 *
 * Copyright 2015- Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * Copyright 2015-2016 - Gildas Le Nadan
 *
 */

/* Imports */
var aws = require('aws-sdk');
var path = require('path');
var zlib = require('zlib');
var async = require('async');

/* Env specific stuff */
var env = require('./env.json');

/* Globals */
var esDomain = {
    endpoint: env.endpoint,
    region: env.region,
    index: env.index,
    doctype: env.doctype
};

var config = new aws.Config();
var creds = config.credentials;
var endpoint =  new aws.Endpoint(esDomain.endpoint);
var s3 = new aws.S3();

exports.handler = function(event, context) {

    // console.log('Received event: ', JSON.stringify(event, null, 2));

    var bucket = event.Records[0].s3.bucket.name;
    var key = event.Records[0].s3.object.key;

    async.waterfall([
        async.apply(download, bucket, key),
        gunzip,
        pushEachRecords,
    ], function (err, message) {
        if (err) {
            console.log('Error: ' + err);
            context.fail(err);
        } else {
            console.log(message);
            context.succeed(message);
        }
    });
}

function download(bucket, key, callback) {
    console.log('Need to download S3://', bucket, '/', key);
    s3.getObject({
       Bucket: bucket,
       Key: key
    }, function(err, data) {
        if (!err) console.log('S3 object downloaded')
        callback(err, data);
    });
}

function gunzip(object, callback) {
    var buffer = new Buffer(object.Body);
    console.log('Unzipping CloudTrail archive');
    zlib.gunzip(buffer, function(err, decoded) {
        if (!err) console.log('Message unzipped successfully')
        callback(err, decoded && decoded.toString());
    });
}

function pushEachRecords(jsonBuffer, callback) {
    var records;
    console.log('Pushing records');
    try {
        records = JSON.parse(jsonBuffer);
    } catch (err) {
        callback('Unable to parse CloudTrail JSON: ' + err);
        return;
    }
    records.Records.forEach(function(record) {
        postToES(JSON.stringify(record))
    });
    callback(null, 'cloudtrail event pushed');
}

function postToES(record) {
    var req = new aws.HttpRequest(endpoint);

    req.method = 'POST';
    req.path = path.join('/', esDomain.index, esDomain.doctype);
    req.region = esDomain.region;
    req.body = record.toString();
    req.headers['presigned-expires'] = false;
    req.headers['Host'] = endpoint.host;

    // console.log('CloudTrail JSON content:', req.body);

    // Sign the request (Sigv4)
    var signer = new aws.Signers.V4(req, 'es');
    signer.addAuthorization(creds, new Date());

    // Post document to ES
    var send = new aws.NodeHttpClient();
    console.log('Pushing CloudTrail JSON to ES.');
    send.handleRequest(req, null, function(httpResp) {
        var body = '';
        httpResp.on('data', function (chunk) {
            body += chunk;
            console.log('...getting chunk');
        });
        httpResp.on('end', function (chunk) {
            console.log('Response: ' + body);
            console.log('Finished pushing CloudTrail JSON to ES.');
        });
    }, function(err) {
        console.log('Failed to push CloudTrail JSON. Error: ' + err);
    });
}