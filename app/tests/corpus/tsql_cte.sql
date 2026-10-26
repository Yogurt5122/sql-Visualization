WITH paid AS (
  SELECT order_id, user_id, pay_amount
  FROM dbo.t_demo_order
  WHERE status = 'PAID'
)
SELECT TOP (50) user_id, SUM(pay_amount) AS gmv
FROM paid
GROUP BY user_id
ORDER BY gmv DESC;
