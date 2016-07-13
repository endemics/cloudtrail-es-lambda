# Cloudtrail to AWS Elastic Search lambda function

This lambda function is meant to import Cloudtrail event logs stored in S3 into an AWS Elastic Search domain.

## Principles

![Principles](doc/cloudtrail-s3-lambda-es.png "Principles")

- when a new cloudtrail event is stored in S3, an event gets emitted that triggers the lambda function
- the lambda then downloads the gzipped json file, unzip it and push it to the ElasticSearch endpoint

## Lambda function installation

You'll need a machine with npm installed and a copy of this repository.

### Nodejs prerequisites

Prerequisites can be installed via `npm install` while in the repository.

### AWS prerequisites

We are assuming that you have an AWS account set up with a functioning API key.

The API key details and default region should be exposed in the environment as such:

```
export AWS_DEFAULT_REGION=ap-southeast-2
export AWS_SECRET_ACCESS_KEY=MyOWnAWSSecretAccessKeyYouShouldHaveYoursToo
export AWS_ACCESS_KEY_ID=AKIABCDEFGHIJKLMNOPQ
```

To be able to test the function locally or deploy it, you will require:

- an IAM role for the lambda function (see `lambda-s3-cloudtrail-role` below)
- Cloudtrail activated
- ES Domain set up
- a lambda function `s3-cloudtrail-lambda-es` set up with the following:
  - handler `index.handler`
  - using the predefined role above
  - 128 MB and 5s seems enough in my case, YMMV
  - a trigger on  the S3 bucket and path where your cloudtrail logs are stored, with an event type of `ObjectCreatedByPutPrefix/suffix`

Change the `region` value in `env.json` to reflect the AWS region you are operating in.

### Example of IAM role for the lambda function

Create an IAM role `service-role/lambda-s3-cloudtrail-role` with the following policies:
```
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::$bucket/$cloudtrail_prefix/*""
    },
    {
      "Effect": "Allow",
      "Action": "logs:CreateLogGroup",
      "Resource": "arn:aws:logs:$region:$account_id:*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": [
        "arn:aws:logs:$region:$account_id:log-group:/aws/lambda/s3-cloudtrail-lambda-es:*"
      ]
    }
  ]
}
```

With `$region` your AWS region, `$account_id` your AWS Account ID, `$bucket` the name of your S3 bucket containing your cloudtrail logs and`$cloudtrail_prefix` the path where they are stored.

Remember to change the function name in `/aws/lambda/s3-cloudtrail-lambda-es` if you've changed the default.

### Testing the lambda

Before activating the trigger and deploying it, you want to test your lambda is working correctly.

For this, you can create an `event.json` file containing a test event locally, then run:

```
export ES_ENDPOINT=$endpoint
export AWS_ACCOUNT_ID=$account_id
grunt
```

(with `$endpoint` your ES domain endpoint, and `$account_id` your AWS Account ID)

This will automatically set the `env.json` file with your Elastic Endpoint and Account ID and then invoke the function locally.

Please note this will be using whatever AWS credentials you have in your environment.

### Packaging and deploying the lambda

To deploy the lambda, run the following:

```
export ES_ENDPOINT=$endpoint
export AWS_ACCOUNT_ID=$account_id
grunt deploy
```

(with `$endpoint` your ES domain endpoint, and `$account_id` your AWS Account ID)

Note that the AWS credentials set in your environment will need to have the rights to deploy the lambda function.

## ElasticSearch configuration

### Example of ES Domain IAM policy
To allow access to your ES domain, you can allow access on a per IP basis:

```
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::$account_id:root"
      },
      "Action": "es:*",
      "Resource": "arn:aws:es:$region:$account_id:domain/cloudtrail/*"
    },
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "*"
      },
      "Action": "es:*",
      "Condition": {
        "IpAddress": {
          "aws:SourceIp": [
            "$source_ip"
          ]
        }
      },
      "Resource": "arn:aws:es:$region:$account_id:domain/cloudtrail/*"
    }
  ]
}
```

With `$region` your AWS region, `$account_id` your AWS Account ID, `$source_ip` the IP that ElasticSearch will allow.

## Kibana4 dashboards

You can find an example of the dashboard and associated searches/visualizations under `examples/cloudtrail_kibana4_dashboard.json`.

### How to backup the kibana4 dashboards

It is possible to backup the dashboards, visualizations and searches using `curl` and `jq`:

```
curl -s -XGET '$endpoint/.kibana-4/_search?size=50' -d '{"query" : { "filtered" : {"filter": { "or": [ {"type": {"value": "dashboard"}}, {"type" : {"value":"visualization"}}, {"type": {"value": "search"}}] }}}}}'|jq '.hits.hits'
```

(with `$endpoint` set to your ES domain endpoint)

### How to restore the kibana4 dashboards

If you have saved your objects using the command above in a file called `k4.json` you can restore it using:

```
cat k4.json | jq -r -M -c '.[]|select(._type=="search") | [._index,._type,._id,@text "\(._source)"] | join(";")' | awk -F';' '{print "curl -v -XPUT $endpoint/"$1"/"$2"/"$3" -d '\''"$4"'\''"}'> restore.sh
cat k4.json | jq -r -M -c '.[]|select(._type=="visualization") | [._index,._type,._id,@text "\(._source)"] | join(";")' | awk -F';' '{print "curl -v -XPUT $endpoint/"$1"/"$2"/"$3" -d '\''"$4"'\''"}'>> restore.sh
cat k4.json | jq -r -M -c '.[]|select(._type=="dashboard") | [._index,._type,._id,@text "\(._source)"] | join(";")' | awk -F';' '{print "curl -v -XPUT $endpoint/"$1"/"$2"/"$3" -d '\''"$4"'\''"}'>> restore.sh

bash ./restore.sh
```

(with `$endpoint` set to your ES domain endpoint)

## Importing existing events

The following allows you to create one event per existing json cloudtrail file in S3, and then import that in ES:

```
# set $bucket to your bucket name
# set $account_id to your aws account_id

aws s3 --recursive ls s3://$bucket/AWSLogs/$account_id/CloudTrail/ | awk '{print $4}' | sort > bucket.list

mkdir events

idx=0
for f in `cat bucket.list`;do
  ((idx+=1))
  printf '{"Records": [{"s3": {"bucket": {"name": "%s"},"object": {"key": "%s"}}}]}' $bucket $f> events/event_$idx.json
done

# execute the lambda function locally on each event
for i in `ls -1 events/event_*.json`;do
  mv $i event.json
  grunt lambda_invoke
done
```
