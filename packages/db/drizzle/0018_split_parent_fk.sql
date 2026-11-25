-- Parts of a split now reference their parent, so they are removed with it.
-- Before the constraint can be added, repair what its absence allowed:

-- 1. Parts whose parent no longer exists (the bank replaced or removed the transaction).
--    They could not be seen or edited, and were counted on top of the replacement.
DELETE FROM transactions c
WHERE c.split_parent_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM transactions p WHERE p.id = c.split_parent_id);
--> statement-breakpoint

-- 2. Splits whose parts no longer add up to the parent (the bank changed the amount).
--    Undo the split and mark the transaction for review, as a sync now does.
WITH broken AS (
  SELECT p.id FROM transactions p
  WHERE p.is_split
    AND p.amount <> COALESCE((SELECT sum(c.amount) FROM transactions c WHERE c.split_parent_id = p.id), 0)
), gone AS (
  DELETE FROM transactions c USING broken b WHERE c.split_parent_id = b.id
)
UPDATE transactions p SET is_split = false, reviewed = false FROM broken b WHERE p.id = b.id;
--> statement-breakpoint

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_split_parent_id_transactions_id_fk" FOREIGN KEY ("split_parent_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;
