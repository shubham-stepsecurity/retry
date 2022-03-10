import * as core from "@actions/core"
import promise, { all } from 'bluebird'

let WAIT_FOR_FORK = 5

// support nodejs and browser runtime
var base64Encode = function(content:string) {
  if (typeof btoa !== 'undefined') {
    return btoa(content)
  } else {
    return new Buffer(content).toString('base64')
  }
}

export async function forkRepo(octo:any,originRepo:any,ORIGIN_REPO:string,username:string) {
  try{
    let fork = null
    await originRepo.forks.create()
    var tryCounter = 0
    while (fork == null && tryCounter < WAIT_FOR_FORK) {
      core.info('   waiting until repo is forked')
      promise.delay(tryCounter * 1000)
      fork = await octo.repos(username, ORIGIN_REPO).fetch()
      tryCounter++
    }
    if (fork == null) {
      core.info('   could not fork the origin repo')
      return null
    }
    return fork
  }catch(err){
    core.setFailed(err)
  }  
}

export async function createNewBranch(originRepo:any,fork:any, branchName:string) {
  try{
    var forkCommits = await fork.commits.fetch({sha: 'master'})
    var originCommits = await originRepo.commits.fetch({sha: 'master'})
    if (originCommits[0].sha != forkCommits[0].sha) {
      core.info('   master branch of fork is not in sync, force updating from upstream')
      fork.git.refs('heads/master').update({
        force: true,
        sha: originCommits[0].sha
      })
    }
    var allBranches = fork.git.refs.fetch()
    var branch = allBranches.filter(function(item:any) {
      var name = item.ref.split('/')[2] // refs/heads/master -> master
      return name === branchName
    })[0]
    if (branch == null) {
      core.info('   creating branch...')
      var branch = fork.git.refs.create({
        ref: 'refs/heads/' + branchName,
        sha: originCommits[0].sha // recent commit SHA
      })
    }
    return originCommits[0].sha
  }catch(err){
    core.setFailed(err)
  }  
}

export async function commitChanges(fork:any, branchName:string,content:string,path:string, commitMessage:string) {
  try{
    var config = {
      message: commitMessage,
      content: base64Encode(content),
      branch: branchName
    }
    fork.contents(path).add(config)
    return
  }catch(err){
    core.setFailed(err)
  }  
}

export async function doPullRequest(originRepo:any,ORIGIN_BRANCH:string,branchName:string, username:string, title:string, prBody:string) {
  try{
    core.info('   creating pull request...')
    const pullRequest = originRepo.pulls.create({
      title: title,
      body: prBody,
      head: username + ":" + branchName,
      base: ORIGIN_BRANCH
    })
    return {
      ok: true,
      created: true,
      pr: pullRequest,
    }
  }catch(err){
    core.setFailed(err)
  }  
}
