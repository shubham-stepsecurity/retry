import * as core from "@actions/core"
import * as github from "@actions/github"
import Octokat from 'octokat';
import { get_details,getGoodMatch,getFile,getFilesInFolder} from "./goodmatch"
import { getResponse } from "./secureflow"
import {forkRepo, createNewBranch, commitChanges, doPullRequest} from "./utils"
import {prBody,get_pr_update,titlePR} from "./content"  

const issue_id = +core.getInput("issue-id");
const token = core.getInput("github-token")
const branchName = core.getInput("branch")

let actionFailed = false // check action state

const repos = github.context.repo // context repo
const client = github.getOctokit(token) // authenticated octokit

const octo = new Octokat({token: token}) // create fork

core.info("     ================ Starting Automation ================")    

// get info from git issue
core.startGroup("getting details for automation...")
const details =await get_details(client,issue_id,repos.owner,repos.repo)
if(!details.fix_repo){
    core.info(`   key_words: ${details.topic}`)
    core.info(`   min_star: ${details.min_star}`)
    core.info(`   total_pr: ${details.total_pr}`)
}else{
    core.info("   fix all workflows of this repo")
    core.info(`   name: ${details.name}`)
}
core.endGroup()

try{
    if(!details.fix_repo){
        let curr_pr=0
        // iterate till we get desired number of PR's
        while (curr_pr<details.total_pr) {
            core.startGroup("getting good matches...")
            const {owner,repository,path,content} = await getGoodMatch(client,details.topic,details.min_star)
            core.info("good match:")
            core.info(`   owner: ${owner}`)
            core.info(`   repo: ${repository}`)
            core.info(`   path: ${path}`)
            core.endGroup()

            // secure flow using https://app.stepsecurity.io/
            core.info("\nsecuring workflow...")
            const secureWorkflow = await getResponse(content)
            core.info("secured Workflow")

            core.info("checking for added permissions...")
            // If secured (changed)
            if((content != secureWorkflow.FinalOutput) && !secureWorkflow.HasErrors){
                core.info("permissions were added to the workflow\n")
                core.startGroup("Proceding to forking repo and commiting changes")

                const originRepo = octo.repos(owner,repository)

                try{
                    // create fork
                    core.info("creating fork of a repo whose workflow can be secured...")
                    await forkRepo(octo,originRepo,repository,repos.owner)

                    // create new branch on fork
                    core.info("creating permissions branch on forked repo...")
                    const commitsha = await createNewBranch(client,owner,repository,repos.owner, branchName)

                    // commit changes to the fork
                    core.info("commiting changes to the forked repo...")
                    let filename = path.split("/")[2]
                    let commitMessage = "added permisions for " + filename
                    await commitChanges(client,repos.owner, repository, branchName, path, secureWorkflow.FinalOutput, commitMessage,commitsha)

                    const autoPR = core.getInput("auto-pr")
                    if(autoPR == "true"){
                        // get ORIGIN_BRANCH
                        core.info("getting default branch of remote repo...")
                        const REMOTE_REPO = await client.rest.repos.get({owner:owner,repo:repository})
                        let ORIGIN_BRANCH = REMOTE_REPO.data.default_branch
                        core.info(`  Default branch: ${ORIGIN_BRANCH}`)

                        // do pull request to remote branch
                        core.info("creating pull request to remote...")
                        let titlepr = titlePR+path.split("/")[2]
                        const created =await doPullRequest(originRepo,ORIGIN_BRANCH,branchName, repos.owner, titlepr, prBody)
                        if(created){
                            core.info("Created Pull request...")
                        }
                    }
                    core.endGroup()
                }catch(err){
                    core.setFailed(err)
                    actionFailed = true
                }

                // log it by updating comment with pr details and pr url
                core.info("\nadding comment to the issue with details of repo whose workflow was secured")
                let pr_update = get_pr_update(owner,repository,path,repos.owner,secureWorkflow.FinalOutput)
                await client.rest.issues.createComment({owner:repos.owner,repo:repos.repo,issue_number:issue_id,body:pr_update})

                // increment curr_pr
                curr_pr++
                core.info(`secured ${curr_pr} workflow`)
            }

            // TODO: If not secured (not changed), log error by adding comment to the issue

        }
    }else{ // IF fix all, then fix all the workflows of the repo
        const owner_repo = details.name.split("/")
        const owner = owner_repo[0]
        const repository = owner_repo[1]
        try{
            // get list of workflows
            const worklflows = await getFilesInFolder(client, owner, repository)
            
            // create fork
            const originRepo = octo.repos(owner,repository)
            core.info("creating fork of a repo whose workflow can be secured...")
            await forkRepo(octo,originRepo,repository,repos.owner)

            // create new branch on fork
            core.info("creating permissions branch on forked repo...")
            const commitsha = await createNewBranch(client,owner,repository,repos.owner, branchName)

            // iterate over workflows 
            let curr=0
            while(curr<worklflows.length){
                // get content
                const content = await getFile(client,owner,repository,".github/workflows/"+worklflows[curr])

                // fix workflow 
                core.info("\nsecuring workflow...")
                const secureWorkflow = await getResponse(content)
                core.info("secured Workflow")

                core.info(`checking for added permissions in ${worklflows[curr]}...`)
                // If secured (changed)
                if((content != secureWorkflow.FinalOutput) && !secureWorkflow.HasErrors){
                    core.info("permissions were added to the workflow\n")
                    // commit changes to the fork
                    core.info("commiting changes to the forked repo...\n")
                    let commitMessage = "added permisions for " + worklflows[curr]
                    await commitChanges(client,repos.owner, repository, branchName, ".github/workflows/"+worklflows[curr], secureWorkflow.FinalOutput, commitMessage,commitsha)
                    core.info("Changes are commited to the repo")
                    
                    // log it by updating comment with pr details and pr url
                    core.info("adding comment to the issue with details of repo whose workflow was secured\n")
                    let pr_update = get_pr_update(owner, repository, ".github/workflows/"+worklflows[curr], repos.owner, secureWorkflow.FinalOutput)
                    await client.rest.issues.createComment({owner:repos.owner, repo:repos.repo, issue_number:issue_id, body:pr_update})
                    
                }else{
                    core.info("Failed to secure the workflow...\n")
                    //TODO: log the error
                }
                curr++
            }
        }catch(err){
            core.setFailed(err)
            actionFailed = true
        }
    }
}catch(err){
    core.setFailed(err)
    actionFailed = true
}

if(!actionFailed){
    core.info(`secured desired(${details.total_pr}) number of workflow...`)
    core.info(`action executed successfully :)`)
}else{
    core.info(`action failed :(`)
}

//TODO: improve logging
//TODO: update fork code to use client instead of octokat
//TODO: fix star issue for getting good matches (It might be because the seconadry rate limit is exceeding)
//      add try catch statement to getcontent and wait for token permission to reset, repeat till we get desired output