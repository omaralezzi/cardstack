import {
  Repository as NGRepository,
  Tree as NGTree,
  Treebuilder as NGTreebuilder,
  TreeEntry as NGTreeEntry,
  Blob as NGBlob,
} from 'nodegit';

import fs, { existsSync } from 'fs';
import { join } from 'path';

const { unlink } = fs.promises;

import {
  addRemote as igAddRemote,
  checkout as igCheckout,
  clone as igClone,
  commit as igCommit,
  currentBranch as igCurrentBranch,
  fetch as igFetch,
  findMergeBase as igFindMergeBase,
  init as igInit,
  listBranches as igListBranches,
  log as igLog,
  merge as igMerge,
  plugins as igPlugins,
  push as igPush,
  readCommit as igReadCommit,
  resolveRef as igResolveRef,
  writeBlob as igWriteBlob,
  writeRef as igWriteRef,

  // types
  ReadCommitResult,
} from 'isomorphic-git';

igPlugins.set('fs', fs);

export const enum FILEMODE {
  UNREADABLE = 0,
  TREE = 16384,
  BLOB = 33188,
  EXECUTABLE = 33261,
  LINK = 40960,
  COMMIT = 57344,
}

// there is no type for this
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const { setThreadSafetyStatus } = require('nodegit');
// This is supposed to enable thread-safe locking around all async
// operations.
setThreadSafetyStatus(1);

export interface RemoteConfig {
  url: string;
  privateKey: string;
  cacheDir: string;
  publicKey: string;
  passphrase: string;
}

import moment, { Moment } from 'moment-timezone';

export interface CommitOpts {
  authorDate?: Moment;
  authorEmail: string;
  authorName: string;
  message: string;
  committerName?: string;
  committerEmail?: string;
}

interface PushOptions {
  force?: boolean;
}

export class Repository {
  static async open(path: string) {
    let bare = !existsSync(join(path, '.git'));

    try {
      let opts = bare ? { gitdir: path } : { dir: path };
      // Try to get the current branch to check if it's really a git repo or not
      await igCurrentBranch(opts);
    } catch (e) {
      throw new RepoNotFound();
    }
    return new Repository(path, bare);
  }

  static async initBare(gitdir: string): Promise<Repository> {
    await igInit({ gitdir, bare: true });
    return await Repository.open(gitdir);
  }

  static async clone(url: string, dir: string) {
    await igClone({
      url,
      dir,
    });
    return await Repository.open(dir);
  }

  public gitdir: string;

  constructor(public path: string, private bare: boolean = false) {
    if (bare) {
      this.gitdir = path;
    } else {
      this.gitdir = join(path, '.git');
    }
  }

  async getMasterCommit(): Promise<Commit> {
    let sha = await igResolveRef({
      gitdir: this.gitdir,
      ref: 'master',
    });
    return await Commit.lookup(this, sha);
  }

  async getRemote(remote: string): Promise<Remote> {
    return new Remote(this, remote);
  }

  async createBlobFromBuffer(buffer: Buffer): Promise<Oid> {
    let sha = await igWriteBlob({
      gitdir: this.gitdir,
      blob: buffer,
    });

    return new Oid(sha);
  }

  async fetchAll() {
    await igFetch({
      gitdir: this.gitdir,
    });
  }

  async mergeBranches(to: string, from: string) {
    await igMerge({
      gitdir: this.gitdir,
      ours: to,
      theirs: from,
      fastForwardOnly: true,
    });
  }

  async getReference(branchName: string) {
    return await Reference.lookup(this, branchName);
  }

  async createBranch(targetBranch: string, headCommit: Commit): Promise<Reference> {
    await igWriteRef({
      gitdir: this.gitdir,
      ref: `refs/heads/${targetBranch}`,
      value: headCommit.sha(),
      force: true,
    });

    return await Reference.lookup(this, targetBranch);
  }

  async checkoutBranch(reference: Reference) {
    await igCheckout({
      dir: this.path,
      gitdir: this.gitdir,
      ref: reference.toString(),
    });
  }

  async getHeadCommit() {
    return await Commit.lookup(this, 'HEAD');
  }

  async getReferenceCommit(name: string): Promise<Commit> {
    return await Commit.lookup(this, name);
  }

  async lookupLocalBranch(branchName: string) {
    let branches = await igListBranches({ gitdir: this.gitdir });

    if (branches.includes(branchName)) {
      return await this.lookupReference(`refs/heads/${branchName}`);
    } else {
      throw new BranchNotFound();
    }
  }

  async lookupRemoteBranch(remote: string, branchName: string) {
    let branches = await igListBranches({ gitdir: this.gitdir, remote });

    if (branches.includes(branchName)) {
      return await this.lookupReference(`refs/remotes/${remote}/${branchName}`);
    } else {
      throw new BranchNotFound();
    }
  }

  async lookupReference(reference: string) {
    return await Reference.lookup(this, reference);
  }

  async reset(commit: Commit, hard: boolean) {
    let ref = await igCurrentBranch({
      gitdir: this.gitdir,
      fullname: true,
    });

    await igWriteRef({
      gitdir: this.gitdir,
      ref: ref!,
      value: commit.sha(),
    });

    if (hard) {
      await unlink(join(this.gitdir, 'index'));
      await igCheckout({ dir: this.path, ref: ref! });
    }
  }

  isBare() {
    return this.bare;
  }

  async getNgRepo() {
    let ngrepo = this.bare ? await NGRepository.openBare(this.path) : await NGRepository.open(this.path);
    return ngrepo;
  }
}

export class Commit {
  static async create(repo: Repository, commitOpts: CommitOpts, tree: Tree, parents: Commit[]): Promise<Oid> {
    let sha = await igCommit(
      Object.assign(formatCommitOpts(commitOpts), {
        gitdir: repo.gitdir,
        tree: tree.id().toString(),
        parent: parents.map(p => p.sha()),
        noUpdateBranch: true,
      })
    );
    return new Oid(sha);
  }

  static async lookup(repo: Repository, id: Oid | string): Promise<Commit> {
    try {
      let commitInfo = await igReadCommit({
        gitdir: repo.gitdir,
        oid: id.toString(),
      });
      return new Commit(repo, commitInfo);
    } catch (e) {
      if (e.code == 'ReadObjectFail') {
        throw new UnknownObjectId();
      } else {
        throw e;
      }
    }
  }

  constructor(private readonly repo: Repository, private readonly commitInfo: ReadCommitResult) {}

  id() {
    return new Oid(this.commitInfo.oid);
  }

  sha() {
    return this.commitInfo.oid;
  }

  async getLog() {
    return await igLog({
      gitdir: this.repo.gitdir,
      ref: this.sha(),
    });
  }

  async getTree() {
    return await Tree.lookup(this.repo, new Oid(this.commitInfo.commit.tree));
  }
}

export class Oid {
  constructor(private readonly sha: string) {}

  toString() {
    return this.sha;
  }

  equal(other: Oid | string) {
    return other.toString() === this.toString();
  }
}
export class RepoNotFound extends Error {}
export class BranchNotFound extends Error {}
export class GitConflict extends Error {}
export class UnknownObjectId extends Error {}

class Reference {
  constructor(private readonly repo: Repository, private readonly reference: string, private readonly sha: string) {}

  static async lookup(repo: Repository, reference: string) {
    let sha = await igResolveRef({
      gitdir: repo.gitdir,
      ref: reference,
    });

    return new Reference(repo, reference, sha);
  }

  target() {
    return new Oid(this.sha);
  }

  async setTarget(id: Oid): Promise<void> {
    await igWriteRef({
      gitdir: this.repo.gitdir,
      ref: this.reference,
      value: id.toString(),
      force: true,
    });
  }

  toString() {
    return this.reference;
  }
}

export class Remote {
  static async create(repo: Repository, remote: string, url: string): Promise<Remote> {
    await igAddRemote({
      gitdir: await repo.gitdir,
      remote,
      url,
    });

    return new Remote(repo, remote);
  }

  constructor(private readonly repo: Repository, private readonly remote: string) {}

  async push(ref: string, remoteRef: string, options: PushOptions = {}): Promise<void> {
    await igPush(
      Object.assign(
        {
          gitdir: await this.repo.gitdir,
          remote: this.remote,
          ref,
          remoteRef,
        },
        options
      )
    );
  }
}

export class Tree {
  static async lookup(repo: Repository, oid: Oid) {
    let ngtree = await NGTree.lookup(await repo.getNgRepo(), oid.toString());
    return new Tree(ngtree);
  }
  constructor(private readonly ngtree: NGTree) {}

  id() {
    return new Oid(this.ngtree.id().tostrS());
  }

  getNgTree() {
    return this.ngtree;
  }

  entries() {
    return this.ngtree.entries().map(e => new TreeEntry(e));
  }

  entryByName(name: string) {
    // This is apparently private API. There's unfortunately no public
    // API for gracefully attempting to retriee and entry that may be
    // absent.
    let entry,
      ngentry = this.ngtree._entryByName(name);
    if (ngentry) {
      // @ts-ignore this is a hack
      ngentry.parent = this.ngtree;
      entry = new TreeEntry(ngentry);
    }
    return entry;
  }
}

function formatCommitOpts(commitOpts: CommitOpts) {
  let commitDate = moment(commitOpts.authorDate || new Date());

  let author = {
    name: commitOpts.authorName,
    email: commitOpts.authorEmail,
    date: commitDate.toDate(),
    timezoneOffset: -commitDate.utcOffset(),
  };

  let committer;

  if (commitOpts.committerName && commitOpts.committerEmail) {
    committer = {
      name: commitOpts.committerName,
      email: commitOpts.committerEmail,
    };
  }

  return {
    author,
    committer,
    message: commitOpts.message,
  };
}

export class Merge {
  static FASTFORWARD_ONLY = 2;

  static async base(repo: Repository, one: Oid, two: Oid): Promise<Oid> {
    let oids = await igFindMergeBase({
      gitdir: repo.gitdir,
      oids: [one.toString(), two.toString()],
    });
    return new Oid(oids[0]);
  }

  static async perform(repo: Repository, ourCommit: Commit, theirCommit: Commit, commitOpts: CommitOpts) {
    try {
      let res = await igMerge(
        Object.assign(formatCommitOpts(commitOpts), {
          gitdir: repo.gitdir,
          ours: ourCommit.sha(),
          theirs: theirCommit.sha(),
        })
      );

      return res;
    } catch (e) {
      if (e.code === 'MergeNotSupportedFail') {
        throw new GitConflict();
      } else {
        throw e;
      }
    }
  }
}

export class Treebuilder {
  static async create(repo: Repository, tree: Tree | undefined) {
    let ngtreebuilder = await NGTreebuilder.create(await repo.getNgRepo(), tree && tree.getNgTree());
    return new Treebuilder(ngtreebuilder);
  }

  constructor(private readonly ngtreebuilder: NGTreebuilder) {}

  remove(filename: string) {
    this.ngtreebuilder.remove(filename);
  }

  async insert(filename: string, childId: Oid, filemode: FILEMODE) {
    // @ts-ignore expects oid but it will have to live with a string for now
    await this.ngtreebuilder.insert(filename, childId.toString(), filemode);
  }

  entrycount() {
    return this.ngtreebuilder.entrycount();
  }

  async write(): Promise<Oid> {
    let ngoid = await this.ngtreebuilder.write();
    return new Oid(ngoid.tostrS());
  }
}

export class Blob {
  constructor(private readonly ngblob: NGBlob) {}

  id() {
    return new Oid(this.ngblob.id().tostrS());
  }

  content(): Buffer {
    return this.ngblob.content();
  }
}

export class TreeEntry {
  constructor(private readonly ngtreeentry: NGTreeEntry) {}

  isTree() {
    return this.ngtreeentry.isTree();
  }

  filemode() {
    return (this.ngtreeentry.filemode() as unknown) as FILEMODE;
  }

  path() {
    return this.ngtreeentry.path();
  }

  id() {
    return new Oid(this.ngtreeentry.id().tostrS());
  }

  async getBlob(): Promise<Blob> {
    return new Blob(await this.ngtreeentry.getBlob());
  }

  isBlob(): boolean {
    return this.ngtreeentry.isBlob();
  }

  name(): string {
    return this.ngtreeentry.name();
  }

  async getTree() {
    let tree = await this.ngtreeentry.getTree();
    if (tree) {
      return new Tree(tree);
    }
  }
}
