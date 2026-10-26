SELECT TOP (10)
  user_id,
  order_id,
  ROW_NUMBER() OVER (
    PARTITION BY user_id
    ORDER BY created_at DESC
  ) AS rn
FROM dbo.t_demo_order
WHERE status = 'PAID';
