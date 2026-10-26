WITH paid AS (
  SELECT order_id, user_id, pay_amount
  FROM t_demo_order
  WHERE status = 'PAID'
),
t_demo_user_gmv AS (
  SELECT user_id, SUM(pay_amount) AS gmv
  FROM paid
  GROUP BY user_id
)
SELECT u.user_id, u.gmv, d.city
FROM t_demo_user_gmv u
JOIN t_demo_user_dim d ON d.id = u.user_id
WHERE u.gmv > 1000
ORDER BY u.gmv DESC
LIMIT 100;
