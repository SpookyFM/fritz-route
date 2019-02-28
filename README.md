# fritz_route
This command-line tool allows manipulation of static routes on a Fritz!Box via the command line.

## Installation
In order to install (as a command-line tool), use the following command

```shell
npm install fritz_route --global
```

## Usage
This tool will create or update a static IPv4 route on your Fritz!Box. You will need to provide the following arguments:
* `user` The name of your user of the Fritz!Box. The user has to have the rights to make configuration changes
* `password` The password of the user
* `url` The URL of your Fritz!Box. For example `https://fritz.box`
* `network` The network for which you want to setup the route. E.g. `192.168.178.2`
* `subnet` The subnet mask of the network for which you are setting up the route. E.g. `255.255.255.255`
* `gateway` The gateway for your route
* `active` Whether the route will be active (`true`) or inactive (`false`) after running the tool
    
You may also provide these arguments to the script in the form of a JSON file, in this case, only provide the following argument to the script:

* `config-file` The file from which the other arguments should be parsed from.

## FAQ & Disclaimers
**Why not use TR-064?**

I have tried my use-cases with TR-064 several times but never succeeded, because at some point I would always receive an error. Hence, I wrote this tool in order to realize what I wanted to do. Your mileage may vary, and maybe for other Fritz!Box types or OS versions TR-064 might do the trick after all.

**Only tested on Fritz!Box 7490 with FRITZ!OS 07.01**

I was only able to test this tool on my own Fritz!Box so far.

**Use with caution**

Please make sure you know what you are doing. In case of not using this tool correctly, you might lose the connection to your Fritz!Box and have to reset your router in order to regain it.