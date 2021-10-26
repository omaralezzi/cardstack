import { action } from '@ember/object';
import { Participant, WorkflowPostable } from './workflow-postable';
import { IWorkflowSession } from './workflow-session';

export interface WorkflowCardComponentArgs {
  workflowSession: IWorkflowSession;
  options?: Record<string, any>;
  onComplete: (() => void) | undefined;
  onIncomplete: (() => void) | undefined;
  isComplete: boolean;
}

type SuccessCheckResult = {
  success: true;
};

type FailureCheckResult = {
  success: false;
  reason: string;
};

export type CheckResult = SuccessCheckResult | FailureCheckResult;

interface WorkflowCardOptions<K extends keyof ComponentRegistry | string> {
  cardName: string;
  author?: Participant;
  componentName: K; // this should eventually become a card reference
  componentOptions: K extends keyof ComponentRegistry
    ? ComponentRegistry[K]
    : never;
  includeIf?(this: WorkflowCard): boolean;
  check?(this: WorkflowCard): Promise<CheckResult>;
}

export class WorkflowCard extends WorkflowPostable {
  cardName: string;
  componentName: string;
  check: (this: WorkflowCard) => Promise<CheckResult> = () => {
    return Promise.resolve({ success: true });
  };

  constructor(options: WorkflowCardOptions<keyof ComponentRegistry>) {
    super(options.author, options.includeIf);
    this.componentName = options.componentName;

    this.cardName = options.cardName || '';

    this.reset = () => {
      if (this.isComplete) {
        this.isComplete = false;
      }
    };
    if (options.check) {
      this.check = options.check;
    }
  }
  get session(): IWorkflowSession | undefined {
    return this.workflow?.session;
  }

  get completedCardNames(): Array<string> {
    return this.session?.getMeta()?.completedCardNames ?? [];
  }

  @action async onComplete() {
    if (this.isComplete) return;
    let checkResult = await this.check();
    if (checkResult.success) {
      // visible-postables-will-change starts test waiters in animated-workflow.ts
      this.workflow?.emit('visible-postables-will-change');
      this.isComplete = true;
    } else {
      this.workflow?.cancel(checkResult.reason);
    }

    if (this.isComplete && this.cardName) {
      if (!this.completedCardNames.includes(this.cardName)) {
        this.session?.setMeta({
          completedCardNames: [...this.completedCardNames, this.cardName],
          completedMilestonesCount: this.workflow?.completedMilestoneCount,
          milestonesCount: this.workflow?.milestones.length,
        });
      }
    }
  }

  @action onIncomplete() {
    this.workflow?.resetTo(this);

    if (this.cardName && this.completedCardNames.length > 0) {
      const resetToIndex = this.completedCardNames.indexOf(this.cardName);

      this.session?.setMeta({
        completedCardNames: this.completedCardNames.slice(0, resetToIndex),
        completedMilestonesCount: this.workflow?.completedMilestoneCount,
        milestonesCount: this.workflow?.milestones.length,
      });
    }
  }
}

export interface ComponentRegistry {}
