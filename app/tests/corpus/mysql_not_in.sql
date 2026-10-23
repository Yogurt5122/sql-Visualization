SELECT id
FROM dwd_order
WHERE user_id NOT IN (
  SELECT user_id
  FROM dim_user
);
