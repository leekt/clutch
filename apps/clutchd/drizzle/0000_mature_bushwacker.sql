CREATE TYPE "public"."agent_role" AS ENUM('pm', 'research', 'marketing', 'developer', 'qa');--> statement-breakpoint
CREATE TYPE "public"."channel_type" AS ENUM('task', 'department');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('PLAN', 'PROPOSAL', 'EXEC_REPORT', 'REVIEW', 'BLOCKER');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."task_state" AS ENUM('created', 'assigned', 'running', 'review', 'rework', 'done');--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"role" "agent_role" NOT NULL,
	"description" text,
	"image" text NOT NULL,
	"permissions" jsonb NOT NULL,
	"budget" jsonb NOT NULL,
	"secrets" jsonb DEFAULT '[]'::jsonb,
	"status" text DEFAULT 'offline',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agents_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"agent_id" uuid,
	"user_id" text,
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
	"type" "message_type" NOT NULL,
	"channel_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"task_id" uuid,
	"thread_id" uuid,
	"summary" text NOT NULL,
	"body" text NOT NULL,
	"artifacts" jsonb DEFAULT '[]'::jsonb,
	"citations" jsonb DEFAULT '[]'::jsonb,
	"cost" numeric(10, 4) DEFAULT '0',
	"runtime" integer DEFAULT 0,
	"tokens" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"comments" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"state" "task_state" DEFAULT 'created' NOT NULL,
	"workflow_id" text,
	"workflow_step_id" text,
	"assignee_id" uuid,
	"parent_id" uuid,
	"channel_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
