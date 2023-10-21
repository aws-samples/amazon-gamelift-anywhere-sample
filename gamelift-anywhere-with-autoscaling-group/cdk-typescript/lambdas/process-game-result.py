import boto3
import json
import decimal
import os
import logging

logger = logging.getLogger()

logger.setLevel(logging.DEBUG)

# Helper class to convert a DynamoDB item to JSON.
class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, decimal.Decimal):
            if o % 1 > 0:
                return float(o)
            else:
                return int(o)
        return super(DecimalEncoder, self).default(o)

region_name = os.getenv('AWS_REGION')
table_name = os.getenv('TABLE_NAME')

dynamodb = boto3.resource('dynamodb', region_name=region_name)
ddb_table = dynamodb.Table(table_name)

def lambda_handler(event, context):
    logger.debug(event)
    for record in event['Records']:
        parsed = json.loads(record['body'])
        playerName = parsed['PlayerName']
        scoreDiff = parsed['ScoreDiff']
        winDiff = parsed['WinDiff']
        loseDiff = parsed['LoseDiff']

        ddb_table.update_item(
            Key={ 'PlayerName' : playerName },
            UpdateExpression="SET Score = if_not_exists(Score, :basescore) + :score, Win = if_not_exists(Win, :basewin) + :win, Lose = if_not_exists(Lose, :baselose) + :lose, LeaderboardName = if_not_exists(LeaderboardName, LeaderboardName)",
            ExpressionAttributeValues={
                ':basescore': 1000,
                ':basewin': 0,
                ':baselose': 0,
                ':score': scoreDiff,
                ':win': winDiff,
                ':lose': loseDiff
            }
        )