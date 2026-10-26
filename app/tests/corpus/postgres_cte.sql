WITH recent AS (
  SELECT id, user_id, pay_amount
  FROM t_demo_order
  WHERE created_at >= NOW() - INTERVAL '7 days'
)
SELECT user_id, SUM(pay_amount) AS gmv
FROM recent
GROUP BY user_id
ORDER BY gmv DESC
LIMIT 50;
