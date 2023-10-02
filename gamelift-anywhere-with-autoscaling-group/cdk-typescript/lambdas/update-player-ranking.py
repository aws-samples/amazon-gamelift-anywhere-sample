import redis
import os

redis_host = os.getenv('REDIS')
redis = redis.Redis(host=redis_host, db=0)

def lambda_handler(event, context):
    for record in event['Records']:
        print(record)
        playerName = record['dynamodb']['Keys']['PlayerName']['S']

        if record['eventName'] == "REMOVE":
            redis.zrem('Rating', playerName)
        elif 'Score' in record['dynamodb']['NewImage']:
            newScore = int(record['dynamodb']['NewImage']['Score']['N'])
            redis.zadd('Rating', { playerName: newScore })

    return "OK" 