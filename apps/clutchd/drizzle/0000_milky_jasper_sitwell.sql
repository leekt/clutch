CREATE TYPE "public"."agent_role" AS ENUM('pm', 'research', 'marketing', 'developer', 'qa');--> statement-breakpoint
CREATE TYPE "public"."channel_type" AS ENUM('task', 'department');--> statement-breakpoint
CREATE TYPE "public"."domain" AS ENUM('research', 'code', 'code_review', 'planning', 'review', 'ops', 'security', 'marketing');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('task.request', 'task.accept', 'task.progress', 'task.result', 'task.error', 'task.cancel', 'task.timeout', 'chat.message', 'chat.system', 'tool.call', 'tool.result', 'tool.error', 'agent.register', 'agent.heartbeat', 'agent.update', 'routing.decision', 'routing.failure');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."task_state" AS ENUM('created', 'assigned', 'running', 'review', 'rework', 'done', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."trust_level" AS ENUM('sandbox', 'prod');--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"name" text NOT NULL,
	"role" "agent_role" NOT NULL,
	"description" text,
	"version" text DEFAULT '1.0.0',
	"image" text,
	"endpoints" jsonb DEFAULT '{}'::jsonb,
	"capabilities" jsonb DEFAULT '[]'::jsonb,
	"tools" jsonb DEFAULT '[]'::jsonb,
	"permissions" jsonb NOT NULL,
	"budget" jsonb NOT NULL,
	"trust_level" "trust_level" DEFAULT 'sandbox',
	"secrets" jsonb DEFAULT '[]'::jsonb,
	"max_concurrency" integer DEFAULT 1,
	"status" text DEFAULT 'offline',
	"last_heartbeat" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agents_agent_id_unique" UNIQUE("agent_id")
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" text NOT NULL,
	"hash" text NOT NULL,
	"path" text NOT NULL,
	"mime_type" text,
	"size" integer NOT NULL,
	"message_id" text,
	"task_id" text,
	"agent_id" text,
	"storage_path" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "artifacts_artifact_id_unique" UNIQUE("artifact_id"),
	CONSTRAINT "artifacts_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"agent_id" text,
	"user_id" text,
	"run_id" text,
	"task_id" text,
	"details" jsonb DEFAULT '{}'::jsonb,
	"cost" numeric(10, 4),
	"runtime" integer,
	"tokens" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "channel_type" NOT NULL,
	"description" text,
	"task_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text DEFAULT 'clutch/0.1' NOT NULL,
	"message_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"run_id" text NOT NULL,
	"task_id" text NOT NULL,
	"parent_task_id" text,
	"trace_id" text,
	"span_id" text,
	"from_agent_id" text NOT NULL,
	"to_agent_ids" jsonb NOT NULL,
	"type" "message_type" NOT NULL,
	"domain" "domain",
	"payload_type" text,
	"schema_ref" text,
	"payload" jsonb NOT NULL,
	"requires" jsonb DEFAULT '[]'::jsonb,
	"prefers" jsonb DEFAULT '[]'::jsonb,
	"attachments" jsonb DEFAULT '[]'::jsonb,
	"idempotency_key" text,
	"attempt" integer DEFAULT 1,
	"meta" jsonb DEFAULT '{}'::jsonb,
	"channel_id" uuid,
	"cost" numeric(10, 4) DEFAULT '0',
	"runtime" integer DEFAULT 0,
	"tokens" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "messages_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" text NOT NULL,
	"message_id" text NOT NULL,
	"reviewer_id" text NOT NULL,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"comments" text,
	"feedback" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" text NOT NULL,
	"run_id" text NOT NULL,
	"parent_task_id" text,
	"title" text NOT NULL,
	"description" text,
	"state" "task_state" DEFAULT 'created' NOT NULL,
	"workflow_id" text,
	"workflow_step_id" text,
	"assignee_id" uuid,
	"channel_id" uuid,
	"constraints" jsonb DEFAULT '{}'::jsonb,
	"output" jsonb,
	"error" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	CONSTRAINT "tasks_task_id_unique" UNIQUE("task_id")
);
--> statement-breakpoint
CREATE INDEX "artifacts_hash_idx" ON "artifacts" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "artifacts_task_id_idx" ON "artifacts" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "audit_logs_run_id_idx" ON "audit_logs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "audit_logs_task_id_idx" ON "audit_logs" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "audit_logs_agent_id_idx" ON "audit_logs" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "messages_thread_id_idx" ON "messages" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "messages_run_id_idx" ON "messages" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "messages_task_id_idx" ON "messages" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "messages_from_agent_id_idx" ON "messages" USING btree ("from_agent_id");--> statement-breakpoint
CREATE INDEX "messages_type_idx" ON "messages" USING btree ("type");--> statement-breakpoint
CREATE INDEX "messages_idempotency_key_idx" ON "messages" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "tasks_run_id_idx" ON "tasks" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "tasks_parent_task_id_idx" ON "tasks" USING btree ("parent_task_id");--> statement-breakpoint
CREATE INDEX "tasks_state_idx" ON "tasks" USING btree ("state");