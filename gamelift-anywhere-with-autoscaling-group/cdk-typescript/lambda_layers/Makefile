all: redis_layer

clean: clean_redis_layer

redis_layer: redis
	python3 -m pip install --upgrade pip
	pip3 install --requirement redis/requirements.txt --target redis/python

clean_redis_layer:
	rm -rf redis/python/*