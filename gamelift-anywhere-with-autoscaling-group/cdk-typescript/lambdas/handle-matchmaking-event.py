import boto3
import json
import time
import os
import logging

logger = logging.getLogger()

logger.setLevel(logging.DEBUG)

region_name = os.getenv('AWS_REGION')
table_name = os.getenv('TABLE_NAME')
expire_seconds = int(os.getenv('EXPIRE_SECONDS', '300'))

dynamodb = boto3.resource('dynamodb', region_name=region_name)
ddb_table = dynamodb.Table(table_name)

def lambda_handler(event, context):
    logger.debug(event)

    sns_message = json.loads(event['Records'][0]['Sns']['Message'])
    logger.debug(json.dumps(sns_message, indent=2))
    matchevent_status = sns_message['detail']['type']
    if matchevent_status == 'MatchmakingSucceeded':
        matchId = sns_message['detail']['matchId']
        gamesession_info = sns_message['detail']['gameSessionInfo']
        expireAt = int(time.time()) + expire_seconds

        with ddb_table.batch_writer() as batch:
            for ticket in sns_message['detail']['tickets']:
                ticket_id = ticket['ticketId']
                batch.put_item(Item = { 'PlayerName': 'ticket:{}'.format(ticket_id), 'MatchId': matchId, 'GameSessionInfo': json.dumps(gamesession_info), 'ExpireAt': expireAt })
