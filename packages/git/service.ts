import { cloneRepo, Cred, Merge, Repository, Reset, Remote, RemoteConfig } from './git';
import { todo } from '@cardstack/plugin-utils/todo-any';

const { promisify } = require('util');
const mkdirp = promisify(require('mkdirp'));
const filenamifyUrl = require('filenamify-url');
const { existsSync } = require('fs');
const rimraf = promisify(require('rimraf'));
const { join } = require('path');
const { tmpdir } = require('os');
const log = require('@cardstack/logger')('cardstack/git');

class GitLocalCache {
  private _remotes = new Map();

  clearCache() {
    this._remotes = new Map();
  }

  async getRepo(remoteUrl:string, remote:RemoteConfig) {
    let existingRepo = this._remotes.get(remoteUrl);

    if (existingRepo) {
      log.info("existing repo found for %s, reusing it from the cache", remoteUrl);
      return existingRepo.repo;
    }

    let { repo, fetchOpts, repoPath } = await this._makeRepo(remote);

    this._remotes.set(remote.url, {
      repo,
      fetchOpts,
      repoPath,
    });

    return repo;
  }

  async _makeRepo(remote:RemoteConfig) {
    let cacheDirectory = remote.cacheDir;

    if (!cacheDirectory) {
      cacheDirectory = join(tmpdir(), 'cardstack-git-local-cache');

      if(!existsSync(cacheDirectory)) {
        await mkdirp(cacheDirectory);
      }
    }

    let repoPath = join(cacheDirectory, filenamifyUrl(remote.url));

    let fetchOpts = {
      callbacks: {
        credentials: (url:string, userName:string) => {
          if (remote.privateKey) {
            return Cred.sshKeyMemoryNew(userName, remote.publicKey || '', remote.privateKey, remote.passphrase || '');
          }
          return Cred.sshKeyFromAgent(userName);
        }
      }
    };

    log.info("creating local repo cache for %s in %s", remote.url, repoPath);

    let repo;

    if(existsSync(repoPath)) {
      try {
        log.info("repo already exists - reusing local clone");
        repo = await Repository.open(repoPath);
      } catch (e) {
        log.info("creating repo from %s failed, deleting and recloning", repoPath);
        // if opening existing repo fails for any reason we should just delete it and clone it
        await rimraf(repoPath);

        await mkdirp(repoPath);

        repo = await cloneRepo(remote.url, repoPath, {
          fetchOpts
        });
      }
    } else {
      log.info("cloning %s into %s", remote.url, repoPath);
      await mkdirp(repoPath);

      repo = await cloneRepo(remote.url, repoPath, {
        fetchOpts
      });
    }

    return {
      repo,
      fetchOpts,
      repoPath
    };
  }

  async fetchAllFromRemote(remoteUrl:string) {
    let { repo, fetchOpts } = this._remotes.get(remoteUrl);
    return await repo.fetchAll(fetchOpts);
  }

  async pullRepo(remoteUrl:string, targetBranch:string) {
    log.info("pulling changes for branch %s on %s", targetBranch, remoteUrl);
    let { repo } = this._remotes.get(remoteUrl);

    // if branch does not exist locally then create it and reset to head of remote
    // this is required because node git doesn't support direct pull https://github.com/nodegit/nodegit/issues/1123
    try {
      await repo.getReference(`${targetBranch}`);
      log.info("reference for %s on %s already exists, continuing", targetBranch, remoteUrl);
    } catch (e) {
      if(e.message.startsWith('no reference found for shorthand')) {
        log.info("no local branch for %s on %s. Creating it now...", targetBranch, remoteUrl);
        let headCommit = await repo.getHeadCommit();
        let ref = await repo.createBranch(targetBranch, headCommit, false);
        await repo.checkoutBranch(ref, {});
        let remoteCommit = await repo.getReferenceCommit(`refs/remotes/origin/${targetBranch}`);
        Reset.reset(repo, remoteCommit, 3, {});
      } else {
        throw e;
      }
    }

    await repo.mergeBranches(targetBranch, `origin/${targetBranch}`, null, Merge.PREFERENCE.FASTFORWARD_ONLY);
  }
}

module.exports = new GitLocalCache();
