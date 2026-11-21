CREATE TABLE "device_code" (
    "id" text PRIMARY KEY NOT NULL,
    "device_code" text NOT NULL,
    "user_code" text NOT NULL,
    "user_id" uuid,
    "client_id" text,
    "scope" text,
    "status" text NOT NULL,
    "expires_at" timestamp NOT NULL,
    "last_polled_at" timestamp,
    "polling_interval" integer
);
--> statement-breakpoint
ALTER TABLE "device_code" ADD CONSTRAINT "device_code_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "device_code_device_code_unique" ON "device_code" USING btree ("device_code");
--> statement-breakpoint
CREATE UNIQUE INDEX "device_code_user_code_unique" ON "device_code" USING btree ("user_code");
--> statement-breakpoint
CREATE INDEX "device_code_userId_idx" ON "device_code" USING btree ("user_id");
