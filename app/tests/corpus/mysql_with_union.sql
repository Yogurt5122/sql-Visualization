WITH recent AS (
  SELECT order_id, amount
  FROM t_demo_order
  WHERE dt >= '2024-01-01'
)
SELECT order_id FROM recent
UNION ALL
SELECT refund_id FROM t_demo_refund;
