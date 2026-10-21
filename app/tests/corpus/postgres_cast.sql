SELECT
  user_id,
  SUM(pay_amount)::numeric(18, 2) AS gmv,
  COUNT(*)::int AS order_cnt
FROM dwd_order
WHERE dt >= '2024-12-01'
GROUP BY user_id
ORDER BY gmv DESC;
