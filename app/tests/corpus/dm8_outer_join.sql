SELECT a.account_id, b.balance
FROM t_demo_account a, t_demo_balance b
WHERE a.account_id = b.account_id(+)
  AND a.status = 'ACTIVE';
