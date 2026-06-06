pipeline {
    agent any
    stages {
        stage('Detect Branch and Set Environment') {
            steps {
                script {
                    def branchName = env.BRANCH_NAME
                    env.ENVIRON = 'erp_viewer'
                }
            }
        }
        stage('Checkout Configuration Repository') {
            steps {
                script {
                    checkout([
                        $class: 'GitSCM',
                        branches: [[name: "refs/heads/${env.BRANCH_NAME}"]],
                        doGenerateSubmoduleConfigurations: false,
                        extensions: [[$class: 'RelativeTargetDirectory', relativeTargetDir: 'Template']],
                        submoduleCfg: [],
                        userRemoteConfigs: [[credentialsId: 'Jenkins-github-Actecal', url: 'https://github.com/ACTECAL/jenkins-config']]
                    ])

                    def envValuesFile = readFile 'Template/env_values.py'
                    def envVars = evaluate(envValuesFile)

                    def environment = env.ENVIRON.toLowerCase()

                    if (envVars[environment]) {
                        env.TO_MAIL = envVars[environment].TO_MAIL
                        env.CC_MAIL = envVars[environment].CC_MAIL
                        env.CUSTOM_MESSAGE = envVars[environment].CUSTOM_MESSAGE
                    } else {
                        error "Environment '${environment}' not found in the JSON file."
                    }

                }
            }
        }
        stage('move Script'){
            steps {
                sh "mv Template/script_react_yarn.sh ."
                sh "mv Template/env_master.sh ."
            }
        }
        stage('Execute Script') {
            steps {
                sh "chmod +x script_react_yarn.sh"
                sh "./script_react_yarn.sh ${env.ENVIRON}"
            }
        }
}
   post {
        always {
            script {
                def gitAuthor = sh(returnStdout: true, script: 'git log -1 --pretty=format:"%an"').trim()
                def triggeredByUser = null
                if (currentBuild.getBuildCauses('hudson.model.Cause$UserIdCause')['userId']){
                    triggeredByUser = currentBuild.getBuildCauses('hudson.model.Cause$UserIdCause')['userId']
                } else {
                    triggeredByUser = gitAuthor ?: 'Unknown'
                }

                emailext body: "Build ${currentBuild.currentResult}: Job '${env.JOB_NAME} [${env.BUILD_NUMBER}]'\n\n" +
                        "Build URL: ${env.BUILD_URL}\n\n" +
                        "Triggered by: ${triggeredByUser}\n\n" +
                        "${env.CUSTOM_MESSAGE}",
                    subject: "${env.ENVIRON.toUpperCase()} - Jenkins Build Notification - ${env.JOB_NAME} [${env.BUILD_NUMBER}]",
                    to: env.TO_MAIL,
                    cc:env.CC_MAIL,
                    from: "jenkins@valuenable.in"
                }
            }
        }
}
