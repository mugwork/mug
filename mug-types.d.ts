declare module "@mugwork/mug" {
  // --- Registration functions ---

  export function workflow(
    name: string,
    handler: WorkflowHandler,
    options?: WorkflowOptions
  ): WorkflowDef;

  export function source(def: SourceDef): SourceDef;

  export function connector(def: ConnectorDef): ConnectorDef;

  export function agent(config: AgentConfig): AgentConfig;

  // --- Workflow types ---

  export type WorkflowHandler = (ctx: WorkflowContext) => Promise<unknown>;

  export interface WorkflowDef {
    name: string;
    handler: WorkflowHandler;
    options?: WorkflowOptions;
  }

  export type Weekday =
    | "monday"
    | "tuesday"
    | "wednesday"
    | "thursday"
    | "friday"
    | "saturday"
    | "sunday";

  export interface ScheduleConfig {
    cron?: string;
    weekday?: Weekday;
    nth?: number;
    time?: string;
    interval?: string;
    between?: [string, string];
    skipHolidays?: boolean | string;
    skipDates?: string[];
    timezone?: string;
  }

  export interface TriggerConfig {
    type?: "slack_command" | "slack_event" | "slack_shortcut" | "data";
    source?: string;
    table?: string;
    on?: "insert" | "update" | "delete" | "change";
    includeInitialSync?: boolean;
    command?: string;
    description?: string;
    usage_hint?: string;
    event?: string;
    name?: string;
    callback_id?: string;
  }

  export interface WorkflowOptions {
    description?: string;
    billing?: string;
    schedule?: string | ScheduleConfig;
    webhook?: boolean | { auth: "none" | "hmac" | "bearer"; secret?: string };
    inbound?: "sms" | "email" | "slack";
    trigger?: TriggerConfig;
    maxOperations?: number;
  }

  // --- WorkflowContext (the `ctx` object) ---

  export interface WorkflowContext {
    readonly steps: StepRecord[];
    params: Record<string, unknown>;
    changesetId?: string;
    changesetSource?: string;
    instanceId?: string;
    readonly isDemo: boolean;

    secret(name: string): string;
    credential(name: string): string;

    query(
      sql: string,
      params?: (string | number | null)[]
    ): Promise<Record<string, unknown>[]>;
    query(
      database: string,
      sql: string,
      params?: (string | number | null)[]
    ): Promise<Record<string, unknown>[]>;

    exec(
      sql: string,
      params?: (string | number | null)[]
    ): Promise<number>;
    exec(
      database: string,
      sql: string,
      params?: (string | number | null)[]
    ): Promise<number>;

    ai(model: string, options: AiOptions): Promise<AiResponse>;
    search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
    ask(question: string, options?: AskOptions): Promise<AskResult>;
    embed(texts: string[]): Promise<number[][]>;

    readonly notify: {
      email(options: NotifyOptions): Promise<string>;
      sms(options: NotifyOptions): Promise<string>;
      slack(options: NotifyOptions): Promise<string>;
      channel(name: string, options: NotifyOptions): Promise<string>;
    };

    readonly slack: {
      updateMessage(options: {
        channel: string;
        ts: string;
        text?: string;
        blocks?: unknown[];
      }): Promise<void>;
      openModal(options: {
        triggerId: string;
        view: Record<string, unknown>;
      }): Promise<void>;
      updateModal(options: {
        viewId: string;
        view: Record<string, unknown>;
      }): Promise<void>;
    };

    slackApiCall(
      method: string,
      body: Record<string, unknown>
    ): Promise<Record<string, unknown>>;

    file(path: string): Promise<ArrayBuffer>;
    fileText(path: string): Promise<string>;

    surfaceUrl(surfaceId: string, path?: string): string;
    respond(body: unknown, status?: number): Promise<void>;

    agent(name: string, options: AgentInvokeOptions): Promise<AgentResult>;
    collect(options: CollectOptions): Promise<string>;

    waitFor<T = unknown>(
      eventName: string,
      options?: WaitForOptions
    ): Promise<WaitForResult<T>>;
    waitForUrl(eventName: string): Promise<string>;

    http(url: string, options?: HttpOptions): Promise<HttpResult>;

    action(connectorName: string): ConnectorHandle;
    rollback(actionId: string): Promise<ActionResult>;
    rollbackRun(workflowRunId: string): Promise<{
      rolledBack: ActionResult[];
      failed: { actionId: string; error: string }[];
    }>;
  }

  // --- AI types ---

  export interface AiOptions {
    prompt: string;
    system?: string;
    maxTokens?: number;
    routing?: RoutingConfig;
    billing?: string;
  }

  export interface AiResponse {
    text: string;
    model: string;
    usage: { input_tokens: number; output_tokens: number };
    routing?: {
      tier: string;
      model: string;
      provider: string;
      reason: string;
    };
  }

  export interface RoutingConfig {
    fast?: string;
    balanced?: string;
    powerful?: string;
  }

  // --- Notification types ---

  export interface NotifyOptions {
    to: string;
    message: string;
    subject?: string;
    fromName?: string;
    cta?: { label: string; url: string };
    blocks?: unknown[];
    thread_ts?: string;
    unfurl_links?: boolean;
    unfurl_media?: boolean;
  }

  // --- Search / Ask types ---

  export interface SearchOptions {
    source?: string;
    limit?: number;
    filter?: Record<string, string>;
  }

  export interface SearchResult {
    score: number;
    table: string;
    primaryKey: string;
    row: Record<string, unknown>;
  }

  export interface AskOptions {
    source?: string;
    limit?: number;
    model?: string;
    system?: string;
  }

  export interface AskResult {
    answer: string;
    sources: SearchResult[];
    usage: {
      input_tokens: number;
      output_tokens: number;
      search_results: number;
    };
  }

  // --- HTTP types ---

  export interface HttpOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    throwOnError?: boolean;
    retry?: { attempts?: number } | false;
    timeout?: number;
    sign?: { secret: string; header?: string };
  }

  export interface HttpResult {
    status: number;
    headers: Record<string, string>;
    body: string;
    json: unknown;
    ok: boolean;
  }

  export class HttpError extends Error {
    status: number;
    result: HttpResult;
  }

  // --- Agent invocation types ---

  export interface AgentInvokeOptions {
    goal: string;
    context?: Record<string, unknown>;
    sessionKey?: string;
    caps?: Partial<AgentCaps>;
  }

  export interface AgentResult {
    response: string;
    output?: Record<string, unknown>;
    usage: { credits: number; turns: number; duration: number };
    capped?: boolean;
    cappedReason?: string;
    pendingApproval?: {
      tool: string;
      args: Record<string, unknown>;
      sessionKey: string;
    };
  }

  // --- Wait / event types ---

  export interface WaitForOptions {
    timeout?: string | number;
    message?: string;
  }

  export interface WaitForResult<T = unknown> {
    payload: T;
    type: string;
    timedOut: boolean;
  }

  // --- Action / connector handle types ---

  export type ActionType = "read" | "create" | "update" | "delete" | "upsert";

  export interface ActionResult<T = Record<string, unknown>> {
    connector: string;
    table: string;
    operation: ActionType;
    recordId?: string;
    data: T;
    snapshot?: Record<string, unknown>;
    operationId: string;
  }

  export interface ConnectorHandle {
    read(tableName: string, recordId: string): Promise<ActionResult>;
    create(
      tableName: string,
      fields: Record<string, unknown>
    ): Promise<ActionResult>;
    update(
      tableName: string,
      recordId: string,
      fields: Record<string, unknown>
    ): Promise<ActionResult>;
    delete(tableName: string, recordId: string): Promise<ActionResult>;
    upsert(
      tableName: string,
      recordId: string,
      fields: Record<string, unknown>
    ): Promise<ActionResult>;
  }

  // --- Step / result types ---

  export interface StepRecord {
    name: string;
    type: string;
    billable: boolean;
    startedAt: number;
    completedAt?: number;
    durationMs?: number;
    input?: string;
    output?: string;
    error?: string;
    tokensUsed?: number;
  }

  export interface WorkflowResult {
    workflow: string;
    runId: string;
    status: "complete" | "errored";
    startedAt: string;
    completedAt: string;
    durationMs: number;
    stepCount: number;
    steps: StepRecord[];
    result?: unknown;
    error?: string;
    webhookResponse?: WebhookResponse;
  }

  export interface WebhookResponse {
    body: unknown;
    status: number;
  }

  // --- Source / connector config types ---

  export interface SourceContext {
    credential: (name: string) => Promise<string>;
    lastSync: string | null;
    fetch: (url: string, init?: RequestInit) => Promise<Response>;
  }

  export interface PaginationConfig {
    style: "cursor" | "offset" | "page" | "link-header";
    cursorParam?: string;
    cursorPath?: string;
    offsetParam?: string;
    pageParam?: string;
    pageSizeParam?: string;
    defaultPageSize?: number;
    maxPageSize?: number;
  }

  export interface RateLimitConfig {
    requestsPerSecond?: number;
    requestsPerMinute?: number;
  }

  export interface SyncConfig {
    filterParam?: string;
    filterFormat?: "iso8601" | "unix" | "epoch_ms";
    updatedAtField?: string;
    deletedAtField?: string;
    isDeletedField?: string;
    deletionStrategy?:
      | "soft-delete-field"
      | "tombstone-endpoint"
      | "full-sync-only";
  }

  export interface ErrorRetryConfig {
    maxRetries?: number;
    retryOn5xx?: boolean;
    retryOn429?: boolean;
    backoffMs?: number;
  }

  export interface TableDef {
    name: string;
    primaryKey: string;
    endpoint?: string;
    fetch: (ctx: SourceContext) => Promise<Record<string, unknown>[]>;
    extractItems?: (body: unknown) => Record<string, unknown>[];
    pagination?: PaginationConfig;
    sync?: SyncConfig;
  }

  export interface SourceDef {
    name: string;
    description?: string;
    database: string;
    syncSchedule?: string;
    tables: TableDef[];
    baseUrl?: string;
    rateLimits?: RateLimitConfig;
    errorRetry?: ErrorRetryConfig;
  }

  export interface TableActions {
    create?: (
      ctx: SourceContext,
      fields: Record<string, unknown>
    ) => Promise<Record<string, unknown>>;
    update?: (
      ctx: SourceContext,
      recordId: string,
      fields: Record<string, unknown>
    ) => Promise<Record<string, unknown>>;
    delete?: (
      ctx: SourceContext,
      recordId: string
    ) => Promise<Record<string, unknown>>;
    upsert?: (
      ctx: SourceContext,
      recordId: string,
      fields: Record<string, unknown>
    ) => Promise<Record<string, unknown>>;
  }

  export interface ConnectorTableDef extends TableDef {
    get?: (
      ctx: SourceContext,
      recordId: string
    ) => Promise<Record<string, unknown> | null>;
    actions?: TableActions;
  }

  export interface ConnectorDef extends Omit<SourceDef, "tables"> {
    tables: ConnectorTableDef[];
  }

  // --- Agent config types ---

  export type AgentModel =
    | "claude-sonnet"
    | "claude-haiku"
    | "claude-opus"
    | "gpt-4o"
    | "gpt-4o-mini"
    | "gpt-4.1-nano"
    | "gpt-4.1-mini"
    | "gpt-4.1"
    | (string & {});

  export interface AgentTierRouting {
    fast?: string;
    balanced?: string;
    powerful?: string;
  }

  export type AgentMemory =
    | boolean
    | { entities?: boolean; outcomes?: boolean; struggles?: boolean };

  export type AgentToolGrant =
    | "query"
    | "search"
    | "ask"
    | "notify"
    | "http"
    | "workspace"
    | "ai"
    | "trigger_workflow"
    | (string & {});

  export interface AgentCaps {
    maxTurns?: number;
    maxCredits?: number;
    maxDuration?: number;
  }

  export interface AgentEmailFilter {
    allowDomains?: string[];
    blockDomains?: string[];
    requireSubject?: boolean;
  }

  export interface AgentEmailCategory {
    name: string;
    prompt: string;
    reply?: boolean;
  }

  export interface AgentEmailConfig {
    enabled: boolean;
    address?: string;
    filter?: AgentEmailFilter;
    categories?: AgentEmailCategory[];
    fallback?: "ignore" | string;
  }

  export interface AgentConfig {
    name: string;
    model: AgentModel | AgentTierRouting;
    instructions?: string;
    tools?: AgentToolGrant[];
    workflows?: string[];
    memory?: AgentMemory;
    caps?: AgentCaps;
    requireApproval?: string[];
    chat?: boolean;
    slackName?: string;
    email?: AgentEmailConfig;
  }

  // --- Form / collect types ---

  export interface Condition {
    field: string;
    op: "eq" | "neq" | "in" | "gt" | "lt" | "filled" | "empty";
    value?: string | number | string[];
  }

  export type FieldPrefill =
    | { source: "auth"; column: string }
    | { source: "url"; param: string }
    | {
        source: "db";
        table: string;
        column: string;
        match: { column: string; field?: string; param?: string };
      };

  export interface ValidationRule {
    rule: "min" | "max" | "minLength" | "maxLength" | "pattern";
    value: number | string;
    message: string;
  }

  export interface BaseField {
    name: string;
    label: string;
    required?: boolean;
    placeholder?: string;
    showWhen?: Condition[];
    default?: string | number | boolean;
    prefill?: FieldPrefill;
    locked?: boolean;
    helpText?: string;
    validate?: ValidationRule[];
  }

  export interface TextField extends BaseField {
    type: "text" | "email" | "phone";
    pattern?: string;
  }

  export interface NumberField extends BaseField {
    type: "number";
    min?: number;
    max?: number;
    step?: number;
  }

  export interface SelectField extends BaseField {
    type: "select" | "multiselect";
    options: { label: string; value: string }[];
  }

  export interface DateField extends BaseField {
    type: "date";
    min?: string;
    max?: string;
  }

  export interface TextareaField extends BaseField {
    type: "textarea";
    rows?: number;
    maxLength?: number;
  }

  export interface FileField extends BaseField {
    type: "file";
    accept?: string;
    maxSizeMb?: number;
  }

  export interface CalculatedField {
    name: string;
    type: "calculated";
    label: string;
    expression: string;
    format?: "number" | "currency" | "percent";
    showWhen?: Condition[];
  }

  export interface HiddenField {
    name: string;
    type: "hidden";
    default?: string | number | boolean;
    prefill?: FieldPrefill;
    locked?: boolean;
  }

  export type FormField =
    | TextField
    | NumberField
    | SelectField
    | DateField
    | TextareaField
    | FileField
    | CalculatedField
    | HiddenField;

  export interface PageBranch {
    when: Condition[];
    goto: string;
  }

  export interface FormPage {
    id: string;
    title?: string;
    description?: string;
    fields: FormField[];
    showWhen?: Condition[];
    nextPage?: string | { conditions: PageBranch[]; default: string };
  }

  export interface EditMode {
    table: string;
    recordParam: string;
    matchColumn: string;
  }

  export interface FormAccessPublic {
    mode: "public";
  }

  export interface FormAccessIdentify {
    mode: "identify";
    method: "email" | "phone";
    sessionDuration: string;
  }

  export interface FormAccessAuth {
    mode: "auth";
    method: "email" | "phone";
    table: string;
    matchColumn: string;
    sessionDuration: string;
    query?: string;
  }

  export type FormAccess =
    | FormAccessPublic
    | FormAccessIdentify
    | FormAccessAuth;

  export interface CollectOptions {
    id?: string;
    title: string;
    description?: string;
    submitText?: string;
    fields?: FormField[];
    pages?: FormPage[];
    access?: FormAccess;
    editMode?: EditMode;
    workflow: string;
  }
}
