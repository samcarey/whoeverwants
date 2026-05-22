BEGIN;

DROP INDEX IF EXISTS group_join_requests_requester_idx;
DROP INDEX IF EXISTS group_join_requests_group_status_idx;
DROP INDEX IF EXISTS group_join_requests_pending_unique;
DROP TABLE IF EXISTS group_join_requests;

COMMIT;
