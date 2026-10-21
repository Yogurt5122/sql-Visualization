SELECT a.account_id, b.balance
FROM dm_account a, dm_balance b
WHERE a.account_id = b.account_id(+)
  AND a.status = 'ACTIVE';
