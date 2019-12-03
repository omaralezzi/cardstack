import {
  Branch,
  Clone,
  Commit,
  Cred,
  Merge,
  Remote,
  Repository,
  Reset,
  Revwalk,
  Signature,
  Tree,
  Treebuilder,
  TreeEntry,
  Oid,
  Blob
} from "nodegit";

import { FetchOptions } from 'nodegit/fetch-options';

const enum FILEMODE {
    UNREADABLE = 0,
    TREE = 16384,
    BLOB = 33188,
    EXECUTABLE = 33261,
    LINK = 40960,
    COMMIT = 57344
}



// there is no type for this
const { setThreadSafetyStatus } = require('nodegit');
// This is supposed to enable thread-safe locking around all async
// operations.
setThreadSafetyStatus(1);


async function logFromCommit(commit:Commit) {
  let log: any[] = [];

  await new Promise((resolve, reject) => {
    let history = commit.history();
    history.on("commit", (c: any) => log.push(c) );
    history.on('end', resolve);
    history.on('error', reject);
    history.start();
  });

  return log;
}

async function cloneRepo(url:string, path:string, { fetchOpts }: {fetchOpts:FetchOptions}) {
  return await Clone.clone(url, path, { fetchOpts });
}

async function createRemote(repo:Repository, name:string, url:string) {
  return await Remote.create(repo, name, url);
}


export interface RemoteConfig {
  url:string;
  privateKey: string;
  cacheDir: string;
  publicKey: string;
  passphrase: string;
}

export {
  Branch,
  Commit,
  Cred,
  Merge,
  Repository,
  Reset,
  Signature,
  Tree,
  Treebuilder,
  TreeEntry,
  FILEMODE,
  FetchOptions,
  Oid,
  Remote,
  Blob,
  // wrapped
  logFromCommit,
  cloneRepo,
  createRemote
};

