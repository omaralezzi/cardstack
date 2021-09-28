import { Workflow, WorkflowName } from '@cardstack/web-client/models/workflow';

export class WorkflowStub extends Workflow {
  name = 'WITHDRAWAL' as WorkflowName;

  restorationErrors() {
    return [];
  }
  beforeRestorationChecks() {
    return [];
  }
}
