import boto3
from botocore.exceptions import ClientError
import json
import time
import os
import logging

from botocore.config import Config

logger = logging.getLogger()

logger.setLevel(logging.DEBUG)

region_name = os.getenv('AWS_REGION')
table_name = os.getenv('TABLE_NAME')

# Get Global Acccelerator ARN from request. not from environment variable
#globalaccelerator_arn = os.environ['GLOBAL_ACCELERATOR_ARN']

dynamodb = boto3.resource('dynamodb', region_name=region_name)

table = dynamodb.Table(table_name)

def truncateTable():
    #get the table keys
    tableKeyNames = [key.get("AttributeName") for key in table.key_schema]

    #Only retrieve the keys for each item in the table (minimize data transfer)
    projectionExpression = ", ".join('#' + key for key in tableKeyNames)
    expressionAttrNames = {'#'+key: key for key in tableKeyNames}
    
    counter = 0
    page = table.scan(ProjectionExpression=projectionExpression, ExpressionAttributeNames=expressionAttrNames)
    with table.batch_writer() as batch:
        while page["Count"] > 0:
            counter += page["Count"]
            # Delete items in batches
            for itemKeys in page["Items"]:
                batch.delete_item(Key=itemKeys)
            # Fetch the next page
            if 'LastEvaluatedKey' in page:
                page = table.scan(
                    ProjectionExpression=projectionExpression, ExpressionAttributeNames=expressionAttrNames,
                    ExclusiveStartKey=page['LastEvaluatedKey'])
            else:
                break
    logger.debug(f"Deleted {counter}")

def lambda_handler(event, context):
    logger.debug(event)
    globalaccelerator_arn = event['globalaccelerator_arn']
    
    my_config = Config(
        region_name = 'us-west-2',
    )
    
    truncateTable()
    
    client_glaccel = boto3.client('globalaccelerator', config=my_config)
    
    try:
      paginator = client_glaccel.get_paginator('list_custom_routing_port_mappings')
      for page in paginator.paginate(AcceleratorArn=globalaccelerator_arn):
        portMappingList = page['PortMappings']
        logger.debug(f"portMappingList length: {len(portMappingList)}")
        index = 0

        with table.batch_writer() as batch:
          for dic in portMappingList:
            batch.put_item( Item={ 'AcceleratorPort': dic["AcceleratorPort"], 'EndpointGroupArn': dic["EndpointGroupArn"], 'EndpointId': dic["EndpointId"], 'DestinationIpAddress': dic["DestinationSocketAddress"]["IpAddress"], 'DestinationPort': dic["DestinationSocketAddress"]["Port"], 'Protocols': dic["Protocols"], 'DestinationTrafficState': dic["DestinationTrafficState"]})
            index += 1
          logger.debug("Total of uploaded items to DDB: %d", index)
      
    except ClientError as err:
      logger.debug(err)
      return err