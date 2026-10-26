WITH base AS (
  SELECT order_id, user_id, amount, dt
  FROM t_demo_order
  WHERE dt >= '2024-01-01'
),
ranked AS (
  SELECT
    user_id,
    amount,
    ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY amount DESC) AS rn
  FROM base
)
SELECT user_id, SUM(amount) AS total
FROM ranked
WHERE rn <= 3
GROUP BY user_id
UNION ALL
SELECT user_id, total
FROM t_demo_summary
WHERE total > 0;
