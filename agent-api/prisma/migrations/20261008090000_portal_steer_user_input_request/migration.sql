-- Links a mid-run steer to the request_user_input_async question card it answers.
-- Additive nullable column: older releases keep working while chat slots drain.
ALTER TABLE "portal_steer_events" ADD COLUMN "user_input_request_id" TEXT;
