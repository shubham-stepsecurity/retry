import * as core from "@actions/core"
import { components } from '@octokit/openapi-types'

let CURR_PAGE = 1
let CURR_MATCH = 6

export async function get_details(client:any,issue_id:number, owner:string, repo:string){
  try{
    const resp=await client.rest.issues.get({issue_number: Number(issue_id ), owner: owner, repo:repo})
    const body:string=resp.data.body
    const body_content=body.split("\n")
    return{
      topic: body_content[1].split(":")[1],
      min_star: +body_content[2].split(":")[1],
      total_pr: +body_content[3].split(":")[1]
    }
  }catch(err){
    core.setFailed(err)
  }   
}
  
async function getRepoWithWorkflow(client:any,topic:string){  
  try{
    const repoArr=await client.rest.search.code({
    q:topic+" path:.github/workflows",
    per_page:5,
    page:CURR_PAGE    
    })
    CURR_MATCH %= 6
    return repoArr
  }catch(err){
    core.setFailed(err)
  }   
}
  
async function getRepoStars(client:any, owner:string, repo:string){
  try{
    const repo_details = await client.rest.repos.get({owner:owner,repo:repo})
    return repo_details.data.stargazers_count
  }catch(err){
    core.setFailed(err)
  }   
}

type GetRepoContentResponseDataFile = components["schemas"]["content-file"]
async function getFile(client:any,owner:string, repo:string, path:string){
  try{
    const {data} =  await client.rest.repos.getContent({owner: owner, repo: repo,path: path})
    if (!Array.isArray(data)) {
      const workflow = data as GetRepoContentResponseDataFile
  
      if (typeof workflow.content !== undefined) {
        return Buffer.from(workflow.content, "base64").toString() // b64 decoding before returning
      }
    }else{
      core.setFailed("not a file path...")
    }
  }catch(err){
    core.setFailed(err)
  }   
}
  
// check whether the pr is already created or not
async function alreadyCreated(client:any, owner:string, repo:string){
  try{
    // whether pr already created or not (change to all when using in secureworkflow repo)
    const pr = await client.rest.pulls.list({owner:owner,repo:repo,state:"open"})
    return (pr.data.length > 0 ? true:false)
  }catch(err){
    core.setFailed(err)
  }   
}
  
// get good matches
export async function getGoodMatch(client:any, topic:string, min_star:number){
  while(true){
    try{
      const repoArr = await getRepoWithWorkflow(client,topic)
      while(CURR_MATCH<6){
        let owner = repoArr.data.items[CURR_MATCH].repository.owner.login
        let repo = repoArr.data.items[CURR_MATCH].repository.name
        let path = repoArr.data.items[CURR_MATCH].path
        if(await getRepoStars(client,owner,repo)>=min_star && !(await alreadyCreated(client,owner,repo))){
          const content = await getFile(client,owner,repo,path)
          return{
            owner:owner,
            repository:repo,
            path:path,
            content:content
          } 
        }
        CURR_MATCH++
      }
      CURR_PAGE++
    }catch(err){
      core.setFailed(err)
      return
    }   
  }
}

// TODO: log all matches