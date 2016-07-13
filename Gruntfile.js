module.exports = function(grunt) {

  // Project configuration.
  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
    env: grunt.file.readJSON('env.json'),
    lambda_invoke: {
      default: {
        options: {
          file_name: 'index.js'
        }
      }
    },
    lambda_package: {
      default: {
        options: {
          // Task-specific options go here.
        }
      }
    },
    lambda_deploy: {
      default: {
        arn: 'arn:aws:lambda:<%= env.region %>:<%= env.account_id %>:function:<%= env.name %>',
        options: {
          // Task-specific options go here.
        }
      }
    }
  });

  // Update env.json with project specific variables
  grunt.registerTask('env', function () {
    var env = grunt.file.readJSON('env.json');
    if (process.env.AWS_ACCOUNT_ID) {
      env['account_id'] = process.env.AWS_ACCOUNT_ID
    } else {
      var err = new Error('You need to set the AWS_ACCOUNT_ID environment variable');
      throw err;
    }
    if (process.env.ES_ENDPOINT) {
      env['endpoint'] = process.env.ES_ENDPOINT
    } else {
      var err = new Error('You need to set the ES_ENDPOINT environment variable');
      throw err;
    }
    grunt.file.write('env.json', JSON.stringify(env,null,2))
  });

  grunt.loadNpmTasks('grunt-aws-lambda');

  grunt.registerTask('default', ['env','lambda_invoke']);
  grunt.registerTask('deploy', ['env','lambda_package', 'lambda_deploy']);

};